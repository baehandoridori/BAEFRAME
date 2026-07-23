/**
 * baeframe - Renderer App Entry Point
 */

import { createLogger, setupGlobalErrorHandlers } from './logger.js';
import { BFRAME_VERSION, getDataVersion, hasExplicitBframeVersion } from '../../shared/schema.js';
import {
  ensureReviewDocumentId,
  getUnsupportedBframeMajor,
  isValidReviewDocumentId
} from '../../shared/bframe-root-envelope.js';
import { VideoPlayer } from './modules/video-player.js';
import { Timeline } from './modules/timeline.js';
import { CompositionLayerManager } from './modules/composition-layer-manager.js';
import { DrawingManager, DrawingTool } from './modules/drawing-manager.js';
import { ERASER_MODES, normalizeEraserMode } from './modules/drawing-stroke-records.js';
import { CommentManager, MARKER_COLORS, getAuthorColor } from './modules/comment-manager.js';
import { ReviewDataManager, getBframePath } from './modules/review-data-manager.js';
import { LiveblocksManager } from './modules/liveblocks-manager.js';
import { CommentSync } from './modules/comment-sync.js';
import { DrawingSync } from './modules/drawing-sync.js';
import { createFabricDrawingPilotController } from './modules/fabric-drawing-pilot-controller.js';
import { createFabricDrawingPersistenceStore } from './modules/fabric-drawing-persistence-store.js';
import { HighlightManager, HIGHLIGHT_COLORS } from './modules/highlight-manager.js';
import { getUserSettings } from './modules/user-settings.js';
import { getAuthManager } from './modules/auth-manager.js';
import { getThumbnailGenerator } from './modules/thumbnail-generator.js';
import { PlexusEffect } from './modules/plexus.js';
import { getImageFromClipboard, hasImageInClipboard, selectImageFile, isValidImageBase64 } from './modules/image-utils.js';
import { parseVersion, toVersionInfo } from './modules/version-parser.js';
import { getVersionManager } from './modules/version-manager.js';
import { getVersionDropdown } from './modules/version-dropdown.js';
import {
  countImportableFeedbackMarkers,
  importFeedbackIntoTargetComments,
  normalizeFeedbackSourceComments
} from './modules/feedback-import.js';
import { getSplitViewManager } from './modules/split-view-manager.js';
import { getPlaylistManager } from './modules/playlist-manager.js';
import { resizeClusterMembersByEdge } from './modules/comment-cluster.js';
import { getCutlistManager } from './modules/cutlist-manager.js';
import { findCurrentCut, mapGlobalTimeToCut } from './modules/cutlist-core.js';
import {
  buildPlaylistSegments,
  CONTINUOUS_STATUS,
  findNextPlayableIndex,
  createSkippedToastMessage,
  mapGlobalTimeToSegment,
  mapLocalTimeToGlobal
} from './modules/playlist-continuous-core.js';
import {
  extractPlaylistCommentRanges,
  formatPlaylistCommentPanelLine,
  formatPlaylistTimecode,
  getPlaylistAggregateCommentKey
} from './modules/playlist-comment-index.js';
import {
  buildCutlistCommentContext,
  extractCutlistCommentRanges,
  formatCutlistCommentLabel,
  formatCutlistCommentPanelLine
} from './modules/cutlist-comment-index.js';
import { getAudioWaveform } from './modules/audio-waveform.js';
import { getPlaybackSync } from './modules/playback-sync.js';
import { getMentionManager } from './modules/mention-manager.js';
import { TEAM_MEMBERS } from './modules/team-members.js';
import { getSlackNotifier } from './modules/slack-notifier.js';
import { getRecentFilesManager } from './modules/recent-files-manager.js';
import * as recentFilesView from './modules/recent-files-view.js';
import { computeToastStackLayout, computeToastTimerPlan } from './modules/toast-stack-core.js';
import {
  getEffectiveKeyboardShortcutTarget,
  isTextEntryShortcutTarget,
  shouldIgnoreComposingKeyboardEvent,
  shouldHandlePlayPauseShortcutFromTarget,
  shouldIgnoreGlobalShortcutTarget
} from './modules/keyboard-shortcut-targets.js';

const log = createLogger('App');

const SUPPORTED_VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
const SUPPORTED_MEDIA_EXTENSIONS = [...SUPPORTED_VIDEO_EXTENSIONS, ...SUPPORTED_AUDIO_EXTENSIONS];
const SUPPORTED_COMPOSITION_EXTENSIONS = [...SUPPORTED_VIDEO_EXTENSIONS, ...SUPPORTED_IMAGE_EXTENSIONS];
const ALPHA_PRESERVING_COMPOSITION_EXTENSIONS = ['webm', 'webp'];
const SUPPORTED_PLAYLIST_EXTENSION = 'bplaylist';
const SUPPORTED_CUTLIST_EXTENSION = 'bcutlist';
const MPV_OVERLAY_LIVE_DRAW_SYNC_INTERVAL_MS = 48;
const MPV_OVERLAY_FADE_OUT_SYNC_DELAY_MS = 350;
const FABRIC_PILOT_STATUS_SYNC_INTERVAL_MS = 250;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function createMpvOverlayLifecycle({ onWarning = () => {} } = {}) {
  let generation = 0;
  let activeOwner = null;
  let ready = false;
  let failureWarned = false;

  const owns = (owner) => Boolean(owner && activeOwner && owner === activeOwner);

  return {
    begin(loadToken) {
      activeOwner = Object.freeze({
        generation: ++generation,
        loadToken
      });
      ready = false;
      failureWarned = false;
      return activeOwner;
    },
    invalidate(owner = null) {
      if (owner && !owns(owner)) return false;

      generation += 1;
      activeOwner = null;
      ready = false;
      failureWarned = false;
      return true;
    },
    owns,
    markReady(owner) {
      if (!owns(owner)) return false;
      ready = true;
      return true;
    },
    isReady(owner) {
      return ready && owns(owner);
    },
    captureReadyOwner() {
      return ready ? activeOwner : null;
    },
    markUnavailable(owner, error) {
      if (!owns(owner)) return false;

      ready = false;
      if (!failureWarned) {
        failureWarned = true;
        onWarning(error);
      }
      return true;
    }
  };
}

function createFabricPilotStatusRefreshCoordinator({ run, shouldRun = () => true, onError = () => {} } = {}) {
  if (typeof run !== 'function') {
    throw new TypeError('Fabric pilot status refresh run must be a function');
  }

  let inFlight = null;
  let trailing = false;
  let generation = 0;
  let requestRevision = 0;

  function request() {
    if (!shouldRun()) return null;
    const currentRequestRevision = ++requestRevision;
    if (inFlight) {
      trailing = true;
      return inFlight;
    }

    const requestGeneration = generation;
    const operation = Promise.resolve()
      .then(() => run({
        isCurrent: () => requestGeneration === generation &&
          currentRequestRevision === requestRevision &&
          shouldRun()
      }))
      .catch(error => {
        onError(error);
        return false;
      });
    inFlight = operation;

    const settle = () => {
      if (inFlight !== operation) return;
      inFlight = null;
      if (!shouldRun()) {
        trailing = false;
        return;
      }
      if (!trailing) return;
      trailing = false;
      request();
    };
    void operation.then(settle, settle);
    return operation;
  }

  function cancel() {
    generation += 1;
    trailing = false;
  }

  return { request, cancel };
}

function createMpvTeardownGate() {
  let activeTeardown = null;

  return {
    run(teardown) {
      if (typeof teardown !== 'function') {
        throw new TypeError('mpv teardown must be a function');
      }

      const previousTeardown = activeTeardown;
      const teardownPromise = Promise.resolve(previousTeardown)
        .catch(() => {})
        .then(() => teardown());
      activeTeardown = teardownPromise;

      const clearIfCurrent = () => {
        if (activeTeardown === teardownPromise) {
          activeTeardown = null;
        }
      };
      teardownPromise.then(clearIfCurrent, clearIfCurrent);
      return teardownPromise;
    },
    async waitForIdle() {
      while (activeTeardown) {
        const pendingTeardown = activeTeardown;
        try {
          await pendingTeardown;
        } catch {
          // The teardown caller still observes the original failure. New loads only wait for settlement.
        }
      }
    }
  };
}

function createMpvPilotOwnershipGate({
  teardownGate,
  overlayLifecycle,
  setActiveLoadToken
}) {
  return {
    claim(loadToken, { isStaleVideoLoad = () => false } = {}) {
      return teardownGate.run(() => {
        if (isStaleVideoLoad()) return null;
        setActiveLoadToken(loadToken);
        return overlayLifecycle.begin(loadToken);
      });
    },
    runOwnedTeardown(
      overlayOwner,
      teardown,
      { isOwnerCurrent = () => true } = {}
    ) {
      return teardownGate.run(async () => {
        if (!isOwnerCurrent()) return false;
        if (!overlayLifecycle.invalidate(overlayOwner)) return false;
        return teardown();
      });
    }
  };
}

function createCoalescedAsyncScheduler({
  delayMs,
  run,
  shouldRun = () => true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onError = () => {}
}) {
  let timer = null;
  let inFlight = null;
  let trailing = false;
  let generation = 0;

  function schedule() {
    if (!shouldRun()) return;
    if (inFlight) {
      trailing = true;
      return;
    }
    if (timer) return;

    const scheduledGeneration = generation;
    timer = setTimer(() => {
      timer = null;
      if (scheduledGeneration !== generation || !shouldRun()) return;

      const marker = {};
      inFlight = marker;
      let runResult;
      try {
        runResult = run();
      } catch (error) {
        runResult = Promise.reject(error);
      }

      const runPromise = Promise.resolve(runResult).catch(error => {
        onError(error);
        return false;
      });
      if (scheduledGeneration !== generation) {
        if (inFlight === marker) inFlight = null;
        void runPromise;
        return;
      }

      inFlight = runPromise;
      void runPromise.finally(() => {
        if (inFlight !== runPromise) return;
        inFlight = null;
        if (scheduledGeneration !== generation || !shouldRun()) {
          trailing = false;
          return;
        }
        if (!trailing) return;
        trailing = false;
        schedule();
      });
    }, delayMs);
  }

  function cancel() {
    generation += 1;
    if (timer) clearTimer(timer);
    timer = null;
    inFlight = null;
    trailing = false;
  }

  return { schedule, cancel };
}

function createSharedAsyncCaptureOwner() {
  let inFlight = null;

  function capture(startCapture) {
    if (inFlight) return inFlight;

    let resolveCapture;
    let rejectCapture;
    const capturePromise = new Promise((resolve, reject) => {
      resolveCapture = resolve;
      rejectCapture = reject;
    });
    inFlight = capturePromise;

    try {
      Promise.resolve(startCapture()).then(resolveCapture, rejectCapture);
    } catch (error) {
      rejectCapture(error);
    }

    const clearIfCurrent = () => {
      if (inFlight === capturePromise) {
        inFlight = null;
      }
    };
    capturePromise.then(clearIfCurrent, clearIfCurrent);
    return capturePromise;
  }

  function cancel() {
    inFlight = null;
  }

  return { capture, cancel };
}

function createMpvReviewFrameTracker() {
  let epoch = 0;
  const normalizeFilePath = filePath => String(filePath || '').replace(/\\/g, '/').toLowerCase();
  const normalizeFrame = frame => Math.max(0, Math.floor(Number(frame) || 0));

  return {
    invalidate() {
      epoch += 1;
      return epoch;
    },
    capture(filePath, frame) {
      return Object.freeze({
        epoch,
        filePath: normalizeFilePath(filePath),
        frame: normalizeFrame(frame)
      });
    },
    isSamePosition(snapshot, filePath, frame) {
      return Boolean(
        snapshot &&
        snapshot.filePath === normalizeFilePath(filePath) &&
        snapshot.frame === normalizeFrame(frame)
      );
    },
    isCurrent(snapshot, filePath, frame) {
      return Boolean(
        snapshot &&
        snapshot.epoch === epoch &&
        snapshot.filePath === normalizeFilePath(filePath) &&
        snapshot.frame === normalizeFrame(frame)
      );
    }
  };
}

async function runMpvReviewFreezeCapture({
  captureFrame,
  createCandidate,
  decodeCandidate,
  isCurrent,
  hasValidFrame,
  beginInitialHide,
  commitCandidate,
  hideNativeHost,
  didHideApply,
  markCandidateReady,
  endInitialHide,
  rollbackCandidate,
  restoreNativeHost,
  resyncAfterStale
}) {
  const result = await captureFrame();
  if (!isCurrent()) return false;
  if (!result?.success || !result.dataUrl) {
    throw new Error(result?.error || 'mpv 정지 프레임 캡처 실패');
  }

  const candidate = createCandidate(result.dataUrl);
  await decodeCandidate(candidate);
  if (!isCurrent()) return false;

  if (hasValidFrame) {
    commitCandidate(candidate);
    return true;
  }

  beginInitialHide();
  commitCandidate(candidate);

  async function recoverFromInitialHideFailure() {
    let restored = false;
    try {
      restored = await restoreNativeHost() === true;
    } catch {
      restored = false;
    }

    const stillCurrent = isCurrent();
    endInitialHide();
    if (!stillCurrent) {
      await resyncAfterStale();
      return false;
    }
    if (restored) {
      rollbackCandidate(candidate);
    }
    return true;
  }

  let hideResult;
  try {
    hideResult = await hideNativeHost();
  } catch (error) {
    if (!isCurrent()) {
      endInitialHide();
      await resyncAfterStale();
      return false;
    }
    if (!await recoverFromInitialHideFailure()) return false;
    throw error;
  }

  if (!isCurrent()) {
    endInitialHide();
    await resyncAfterStale();
    return false;
  }
  if (!didHideApply(hideResult)) {
    if (!await recoverFromInitialHideFailure()) return false;
    throw new Error(hideResult?.error || 'mpv 호스트 숨김 실패');
  }

  markCandidateReady(candidate);
  endInitialHide();
  return true;
}

async function prepareMpvCommentReadiness({
  prepareFreeze,
  isStillActive,
  setReady,
  setPreparing = () => {},
  showGuidance
}) {
  setReady(false);
  setPreparing(true);
  const prepared = await prepareFreeze();
  if (!isStillActive()) return false;

  setPreparing(false);
  if (!prepared) return false;

  setReady(true);
  showGuidance();
  return true;
}

async function runMpvReviewFreezeRefresh({
  prepareFreeze,
  isStillActive,
  setReady,
  scheduleRetry
}) {
  const prepared = await prepareFreeze();
  if (!prepared) {
    if (isStillActive()) scheduleRetry();
    return false;
  }
  if (!isStillActive()) return false;

  setReady();
  return true;
}

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
    compositionLayerOverlay: document.getElementById('compositionLayerOverlay'),
    compositionLayerPanel: document.getElementById('compositionLayerPanel'),
    compositionLayerPanelHeader: document.getElementById('compositionLayerPanelHeader'),
    compositionLayerList: document.getElementById('compositionLayerList'),
    btnLayerCompositing: document.getElementById('btnLayerCompositing'),
    btnCompositionLayerAdd: document.getElementById('btnCompositionLayerAdd'),
    btnCompositionLayerUndo: document.getElementById('btnCompositionLayerUndo'),
    btnCompositionLayerRedo: document.getElementById('btnCompositionLayerRedo'),
    btnCompositionLayerPanelCollapse: document.getElementById('btnCompositionLayerPanelCollapse'),
    layersBelowCanvas: document.getElementById('layersBelowCanvas'),
    drawingCanvas: document.getElementById('drawingCanvas'),
    layersAboveCanvas: document.getElementById('layersAboveCanvas'),
    brushSizeHud: document.getElementById('brushSizeHud'),
    onionSkinCanvas: document.getElementById('onionSkinCanvas'),
    selectionOverlayCanvas: document.getElementById('selectionOverlayCanvas'),
    drawingTools: document.getElementById('drawingTools'),
    btnOpenFile: document.getElementById('btnOpenFile'),

    // 컨트롤
    btnFirst: document.getElementById('btnFirst'),
    btnPrevFrame: document.getElementById('btnPrevFrame'),
    btnPlay: document.getElementById('btnPlay'),
    btnNextFrame: document.getElementById('btnNextFrame'),
    btnLast: document.getElementById('btnLast'),
    controlsBar: document.querySelector('.controls-bar'),
    fullscreenSeekbar: document.getElementById('fullscreenSeekbar'),
    timecodeCurrent: document.getElementById('timecodeCurrent'),
    timecodeTotal: document.getElementById('timecodeTotal'),
    frameIndicator: document.getElementById('frameIndicator'),
    btnDrawMode: document.getElementById('btnDrawMode'),
    btnGridToggle: document.getElementById('btnGridToggle'),
    btnFrameCellMode: document.getElementById('btnFrameCellMode'),
    btnAddComment: document.getElementById('btnAddComment'),
    btnPrevComment: document.getElementById('btnPrevComment'),
    btnNextComment: document.getElementById('btnNextComment'),
    btnPrevHighlight: document.getElementById('btnPrevHighlight'),
    btnNextHighlight: document.getElementById('btnNextHighlight'),

    // 타임라인
    timelineSection: document.getElementById('timelineSection'),
    zoomSlider: document.getElementById('zoomSlider'),
    zoomDisplay: document.getElementById('zoomDisplay'),
    toggleCommentTimelineRanges: document.getElementById('toggleCommentTimelineRanges'),
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
    commentSearchBar: document.getElementById('commentSearchBar'),
    commentSearchToggle: document.getElementById('commentSearchToggle'),
    commentSearchPanel: document.getElementById('commentSearchPanel'),
    commentSearchInputWrap: document.getElementById('commentSearchInputWrap'),
    commentSearchInput: document.getElementById('commentSearchInput'),
    commentSearchPlaceholderWord: document.getElementById('commentSearchPlaceholderWord'),
    commentSearchClear: document.getElementById('commentSearchClear'),

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
    videoCommentOverlayControls: document.getElementById('videoCommentOverlayControls'),
    btnVideoZoomIn: document.getElementById('btnVideoZoomIn'),
    btnVideoZoomOut: document.getElementById('btnVideoZoomOut'),
    btnVideoZoomReset: document.getElementById('btnVideoZoomReset'),
    btnVideoCenterLock: document.getElementById('btnVideoCenterLock'),
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
    playlistTabReview: document.getElementById('playlistTabReview'),
    playlistTabContinuous: document.getElementById('playlistTabContinuous'),
    playlistContinuousTools: document.getElementById('playlistContinuousTools'),
    playlistSortMode: document.getElementById('playlistSortMode'),
    playlistContinuousLoop: document.getElementById('playlistContinuousLoop'),
    playlistPrepareSummary: document.getElementById('playlistPrepareSummary'),
    playlistPrepareSummaryText: document.getElementById('playlistPrepareSummaryText'),
    playlistItems: document.getElementById('playlistItems'),
    playlistDropzone: document.getElementById('playlistDropzone'),
    playlistEmpty: document.getElementById('playlistEmpty'),
    playlistAddArea: document.getElementById('playlistAddArea'),
    playlistAddZone: document.getElementById('playlistAddZone'),

    // 컷 묶음 관련
    btnCutlist: document.getElementById('btnCutlist'),
    cutlistSidebar: document.getElementById('cutlistSidebar'),
    cutlistNameInput: document.getElementById('cutlistNameInput'),
    btnCutlistAdd: document.getElementById('btnCutlistAdd'),
    btnCutlistPrimaryAdd: document.getElementById('btnCutlistPrimaryAdd'),
    btnCutlistSave: document.getElementById('btnCutlistSave'),
    btnCutlistCopyLink: document.getElementById('btnCutlistCopyLink'),
    btnCutlistClose: document.getElementById('btnCutlistClose'),
    cutlistSummary: document.getElementById('cutlistSummary'),
    cutlistItems: document.getElementById('cutlistItems'),
    cutlistEmpty: document.getElementById('cutlistEmpty'),
    cutlistIgnoredSummary: document.getElementById('cutlistIgnoredSummary'),
    cutlistShowMissing: document.getElementById('cutlistShowMissing'),
    currentCutOverlay: document.getElementById('currentCutOverlay'),

    // 오디오 웨이브폼
    audioWaveformContainer: document.getElementById('audioWaveformContainer'),

    // 협업 플렉서스 패널
    collabPlexusPanel: document.getElementById('collabPlexusPanel'),
    collabPlexusCanvas: document.getElementById('collabPlexusCanvas'),
    // 최근 파일
    btnRecentFiles: document.getElementById('btnRecentFiles'),
    recentDropdownMenu: document.getElementById('recentDropdownMenu'),
    recentFilesSection: document.getElementById('recentFilesSection')
  };

  // 사용자 설정
  const userSettings = getUserSettings();

  function getCommentEditableTarget(target) {
    if (!(target instanceof Element)) return null;
    const standardEditable = target.closest('.comment-input, .comment-marker-input, .comment-reply-input, .comment-edit-textarea, .comment-reply-edit-textarea, .thread-editor[contenteditable="true"]');
    return standardEditable || target.closest('.playlist-comment-reply-input');
  }

  function getTextEntryFocusableTarget(target) {
    if (!(target instanceof Element)) return null;
    const editable = target.closest('textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (!editable || editable.disabled || editable.readOnly) return null;
    return isTextEntryShortcutTarget(editable) ? editable : null;
  }

  function resizeReplyEditorToContent(editor) {
    if (!editor) return;

    if (editor instanceof HTMLTextAreaElement) {
      const maxHeight = Number(editor.dataset.maxAutoHeight) || 150;
      editor.style.height = 'auto';
      const nextHeight = Math.min(Math.max(editor.scrollHeight, 34), maxHeight);
      editor.style.height = `${nextHeight}px`;
      editor.style.overflowY = editor.scrollHeight > maxHeight ? 'auto' : 'hidden';
      return;
    }

    if (editor.isContentEditable) {
      const computedMaxHeight = Number.parseFloat(getComputedStyle(editor).maxHeight);
      const maxHeight = Number(editor.dataset.maxAutoHeight) || (Number.isFinite(computedMaxHeight) ? computedMaxHeight : 220);
      editor.style.overflowY = editor.scrollHeight > maxHeight ? 'auto' : '';
    }
  }

  function installTextEntryFocusRecovery() {
    let pendingEditable = null;

    document.addEventListener('pointerdown', handleTextEntryPointerDown, true);
    document.addEventListener('mousedown', handleTextEntryPointerDown, true);

    function requestMainWindowFocusForTextEntry() {
      try {
        const focusRequest = window.electronAPI?.focusMainWindow?.();
        if (focusRequest && typeof focusRequest.catch === 'function') {
          focusRequest.catch((error) => {
            log.debug('입력 포커스 회복 중 메인창 포커스 요청 실패', { error: error.message });
          });
        }
        return focusRequest;
      } catch (error) {
        log.debug('입력 포커스 회복 중 메인창 포커스 요청 실패', { error: error.message });
        return null;
      }
    }

    function handleTextEntryPointerDown(e) {
      const editable = getTextEntryFocusableTarget(e.target);
      if (!editable) return;

      pendingEditable = editable;
      void requestMainWindowFocusForTextEntry();
      window.setTimeout(async () => {
        if (pendingEditable !== editable) return;
        pendingEditable = null;
        if (!document.contains(editable) || document.activeElement === editable) return;

        await requestMainWindowFocusForTextEntry();

        editable.focus({ preventScroll: true });
        if (
          (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) &&
          typeof editable.selectionStart === 'number'
        ) {
          const end = editable.value.length;
          editable.setSelectionRange(end, end);
        }
      }, 0);
    }
  }

  installTextEntryFocusRecovery();

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
    videoCenterLocked: userSettings.getVideoCenterLocked(),
    isPanningVideo: false,
    panStartX: 0,
    panStartY: 0,
    panInitialX: 0,
    panInitialY: 0,
    isSpaceHeld: false,
    spacePanUsed: false,
    isFullscreenScrubbing: false,
    fullscreenScrubStartX: 0,
    fullscreenScrubStartTime: 0,
    fullscreenScrubDuration: 0,
    // 오디오 모드
    isAudioMode: false
  };

  // 댓글 필터 전역 상태
  const commentFilterState = {
    status: 'all',      // 'all' | 'unresolved' | 'resolved'
    authors: null,       // null = 전체 (필터 없음), [] = 아무도 선택 안 됨, [ids] = 특정 작성자
    showMarkers: true    // 뷰포트 마커 표시 여부
  };

  const playlistUIState = {
    mode: 'review'
  };

  let suppressCommentRangeRefreshOnce = false;

  const cutlistUIState = {
    active: false,
    lastIgnored: []
  };

  const continuousPlaybackState = {
    active: false,
    waiting: false,
    skippedBatch: [],
    preparePromises: new Map(),
    loadingItemId: null,
    loadingSessionId: null,
    preparedMediaPaths: new Map(),
    sessionId: 0
  };

  let suppressPlaylistSelectionLoad = false;
  let playlistAutoPlayAfterSelection = false;
  let playlistSelectionLoadToken = 0;
  let playlistReplacementToken = 0;
  let playlistReplacementCommitToken = 0;
  let playlistContinuousNavigationToken = 0;
  const playlistExpandedReplyKeys = new Set();
  const playlistMediaPreload = {
    element: null,
    itemId: null,
    path: null,
    ready: false,
    token: 0
  };
  const cutlistMediaPreload = {
    element: null,
    cutId: null,
    sourceId: null,
    path: null,
    frame: null,
    ready: false,
    token: 0
  };
  let playlistTimelineUpdateToken = 0;
  let playlistBackgroundWorkToken = 0;
  let playlistSortChangeToken = 0;
  let playlistAggregateCommentRanges = [];
  let cutlistAggregateCommentRanges = [];
  let cutlistCommentTimelineUpdateToken = 0;
  let cutlistPlaybackTransitioning = false;
  let videoTransitionFreezeCanvas = null;

  /**
   * 작성자 필터 적용 헬퍼
   * @param {Array} items - authorId/author 필드를 가진 객체 배열
   * @returns {Array} 필터링된 배열
   */
  function filterByAuthors(items) {
    if (commentFilterState.authors === null) return items;
    if (commentFilterState.authors.length === 0) return []; // 아무도 선택 안 됨
    const authorFilter = new Set(commentFilterState.authors);
    return items.filter(m => {
      const id = m.authorId || m.author || 'unknown';
      return authorFilter.has(id);
    });
  }

  function isPlaylistFilePath(filePath) {
    const normalized = String(filePath || '').split(/[?#]/)[0].toLowerCase();
    return normalized.endsWith(`.${SUPPORTED_PLAYLIST_EXTENSION}`);
  }

  function isCutlistFilePath(filePath) {
    const normalized = String(filePath || '').split(/[?#]/)[0].toLowerCase();
    return normalized.endsWith(`.${SUPPORTED_CUTLIST_EXTENSION}`);
  }

  function normalizeComparableFilePath(filePath) {
    return String(filePath || '')
      .replace(/^file:\/\//i, '')
      .replace(/\//g, '\\')
      .toLowerCase();
  }

  function isSameFilePath(a, b) {
    return normalizeComparableFilePath(a) === normalizeComparableFilePath(b);
  }

  function invalidatePlaylistBackgroundWork() {
    playlistBackgroundWorkToken += 1;
  }

  async function cancelPlaylistBackgroundTranscodesForMpvPilot(reason = 'mpv 파일럿 사용') {
    invalidatePlaylistBackgroundWork();
    try {
      await window.electronAPI.ffmpegCancel();
      log.info('mpv 파일럿 사용으로 FFmpeg 백그라운드 준비 취소', { reason });
    } catch (error) {
      log.warn('mpv 파일럿 FFmpeg 백그라운드 준비 취소 실패', { reason, error: error.message });
    }
  }

  function resetPlaylistContinuousTimelineState() {
    playlistTimelineUpdateToken += 1;
    playlistAggregateCommentRanges = [];
    timeline.clearPlaylistTimeline();
  }

  function beginPlaylistReplacement() {
    playlistReplacementToken += 1;
    return playlistReplacementToken;
  }

  function commitPlaylistReplacement() {
    playlistSelectionLoadToken += 1;
    invalidateActiveVideoLoad();
    stopContinuousPlayback();
    invalidatePlaylistBackgroundWork();
    resetPlaylistContinuousTimelineState();
  }

  function restorePlaylistReplacementAfterFailedOpen(replacementToken, previousState) {
    if (replacementToken !== playlistReplacementToken) return;
    playlistReplacementToken = previousState.replacementToken;
  }

  function getDialogFileName(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    return normalized.split('/').filter(Boolean).pop() || '선택한 info 파일';
  }

  function normalizePlaylistOpenPath(path) {
    let filePath = path || '';
    if (filePath.startsWith('baeframe://')) {
      filePath = filePath.replace(/^baeframe:\/\//, '');

      try {
        filePath = decodeURIComponent(filePath);
      } catch (error) {
        log.warn('재생목록 URL 디코딩 실패', { error: error.message });
      }

      if (/^[A-Za-z]\//.test(filePath)) {
        filePath = filePath[0] + ':' + filePath.slice(1);
      }

      filePath = filePath.replace(/\//g, '\\');
    }

    return filePath;
  }

  async function openPlaylistFile(filePath) {
    const normalizedPath = normalizePlaylistOpenPath(filePath);
    const playlistManager = getPlaylistManager();
    const previousReplacementState = {
      replacementToken: playlistReplacementToken
    };
    const replacementToken = beginPlaylistReplacement();
    let openedPlaylist;
    try {
      openedPlaylist = await playlistManager.open(normalizedPath, {
        onCommitted: () => {
          if (
            replacementToken !== playlistReplacementToken ||
            playlistReplacementCommitToken > replacementToken
          ) {
            return false;
          }
          playlistReplacementCommitToken = replacementToken;
          commitPlaylistReplacement();
          return true;
        }
      });
    } catch (error) {
      restorePlaylistReplacementAfterFailedOpen(replacementToken, previousReplacementState);
      throw error;
    }
    if (!openedPlaylist) {
      restorePlaylistReplacementAfterFailedOpen(replacementToken, previousReplacementState);
      return;
    }
    if (
      playlistReplacementCommitToken !== replacementToken ||
      playlistManager.currentPlaylist !== openedPlaylist
    ) {
      return;
    }
    showPlaylistSidebar();
    if (playlistManager.getItemCount() > 0) {
      playlistManager.selectItem(0);
    }
    if (playlistUIState.mode === 'continuous') {
      updatePlaylistContinuousTimeline();
    }
    return true;
  }

  function normalizeCutlistOpenPath(path) {
    let filePath = path || '';
    if (filePath.startsWith('baeframe://cutlist')) {
      try {
        const url = new URL(filePath);
        filePath = url.searchParams.get('file') || filePath.replace(/^baeframe:\/\/cutlist\/?/, '');
      } catch (error) {
        log.warn('컷 묶음 URL 디코딩 실패', { error: error.message });
      }
    } else if (filePath.startsWith('baeframe://')) {
      filePath = filePath.replace(/^baeframe:\/\//, '');
    }

    try {
      filePath = decodeURIComponent(filePath);
    } catch (error) {
      log.warn('컷 묶음 경로 디코딩 실패', { error: error.message });
    }

    if (/^[A-Za-z]\//.test(filePath)) {
      filePath = filePath[0] + ':' + filePath.slice(1);
    }

    return filePath.replace(/\//g, '\\');
  }

  async function openCutlistFile(filePath) {
    const normalizedPath = normalizeCutlistOpenPath(filePath);
    const cutlistManager = getCutlistManager();
    await cutlistManager.open(normalizedPath);
    showCutlistSidebar();
    updateCutlistUI();
    updateCutlistTimeline();
    const firstCut = cutlistManager.getOrderedCuts()[0];
    if (firstCut) {
      cutlistManager.selectCut(firstCut.id);
    }
    return true;
  }

  async function saveCurrentCutlist() {
    const cutlistManager = getCutlistManager();
    if (!cutlistManager.currentCutlist) {
      showToast('저장할 컷 묶음이 없습니다.', 'warning');
      return false;
    }

    try {
      const path = await cutlistManager.save();
      showToast('컷 묶음을 저장했습니다.', 'success');
      return path;
    } catch (error) {
      showToast(`컷 묶음을 저장할 수 없습니다: ${error.message}`, 'error');
      return false;
    }
  }

  async function openSelectedPath(filePath) {
    if (isPlaylistFilePath(filePath)) {
      return openPlaylistFile(filePath);
    }

    if (isCutlistFilePath(filePath)) {
      return openCutlistFile(filePath);
    }

    return loadVideo(filePath);
  }

  function getSupportedPlaylistDialogFilters() {
    return [
      { name: '지원 파일', extensions: [...SUPPORTED_MEDIA_EXTENSIONS, SUPPORTED_PLAYLIST_EXTENSION] },
      { name: '미디어 파일', extensions: SUPPORTED_MEDIA_EXTENSIONS },
      { name: 'BAEFRAME 재생목록', extensions: [SUPPORTED_PLAYLIST_EXTENSION] }
    ];
  }

  // ====== 글로벌 Undo/Redo 시스템 ======
  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO_STACK = 50;
  let _isProcessingUndo = false;

  /**
   * Undo 스택에 작업 추가
   * @param {Object} action - { type, data, undo, redo }
   */
  function pushUndo(action) {
    if (!action.timestamp) action.timestamp = Date.now();
    undoStack.push(action);
    if (undoStack.length > MAX_UNDO_STACK) {
      undoStack.shift();
    }
    redoStack.length = 0; // Redo 스택 초기화
  }

  /**
   * 글로벌 Undo 실행 (통합 타임라인)
   */
  async function globalUndo() {
    if (_isProcessingUndo || undoStack.length === 0) return false;
    _isProcessingUndo = true;

    const action = undoStack.pop();
    try {
      if (action && action.undo) {
        // redo를 위해 현재 상태 캡처 (DRAWING 타입인 경우)
        if (action.type === 'DRAWING') {
          const currentSnapshot = drawingManager._createSnapshot();
          action._redoSnapshot = currentSnapshot;
        }
        await action.undo();
        redoStack.push(action);
        return true;
      }
      return false;
    } catch (err) {
      log.error('Undo 실패', err);
      undoStack.push(action); // 롤백
      return false;
    } finally {
      _isProcessingUndo = false;
    }
  }

  /**
   * 글로벌 Redo 실행 (통합 타임라인)
   */
  async function globalRedo() {
    if (_isProcessingUndo || redoStack.length === 0) return false;
    _isProcessingUndo = true;

    const action = redoStack.pop();
    try {
      if (action) {
        // DRAWING 타입의 경우 redo 콜백 대신 _redoSnapshot으로 복원
        // (redo 콜백은 null — drawing-manager.js _saveToHistory 참고)
        if (action.type === 'DRAWING' && action._redoSnapshot) {
          drawingManager._isUndoingOrRedoing = true;
          drawingManager._restoreSnapshot(action._redoSnapshot, {
            actionMetadata: action.drawingAction,
            direction: 'redo'
          });
          drawingManager._isUndoingOrRedoing = false;
          drawingManager._emit('redo');
        } else if (action.redo) {
          await action.redo();
        }
        undoStack.push(action);
        return true;
      }
      return false;
    } catch (err) {
      log.error('Redo 실패', err);
      redoStack.push(action); // 롤백
      return false;
    } finally {
      _isProcessingUndo = false;
    }
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

  const compositionLayerManager = new CompositionLayerManager({
    timeline,
    elements: {
      overlay: elements.compositionLayerOverlay,
      panel: elements.compositionLayerPanel,
      panelHeader: elements.compositionLayerPanelHeader,
      list: elements.compositionLayerList,
      addButton: elements.btnCompositionLayerAdd,
      undoButton: elements.btnCompositionLayerUndo,
      redoButton: elements.btnCompositionLayerRedo,
      collapseButton: elements.btnCompositionLayerPanelCollapse
    },
    openFileDialog: (options) => window.electronAPI.openFileDialog(options),
    fileExists: (filePath) => window.electronAPI.fileExists(filePath),
    showToast,
    getCurrentTime: () => videoPlayer.currentTime || 0,
    getBaseDuration: () => videoPlayer.duration || 0,
    prepareMedia: prepareCompositionLayerMedia,
    scheduleOverlaySync: scheduleMpvOverlayStateSync
  });

  // 드로잉 매니저
  const drawingManager = new DrawingManager({
    canvas: elements.drawingCanvas,
    layersBelowCanvas: elements.layersBelowCanvas,
    layersAboveCanvas: elements.layersAboveCanvas,
    onionSkinCanvas: elements.onionSkinCanvas,
    selectionOverlayCanvas: elements.selectionOverlayCanvas
  });

  // DrawingManager → 통합 undo 스택 연동
  drawingManager._onUndoPush = (action) => pushUndo(action);

  // 댓글 매니저
  const commentManager = new CommentManager({
    fps: 24,
    container: markerContainer
  });

  // 멘션 매니저 (댓글 @멘션 자동완성)
  const mentionManager = getMentionManager();

  // Slack 알림 매니저
  const slackNotifier = getSlackNotifier();

  // 하이라이트 매니저
  const highlightManager = new HighlightManager();

  // 리뷰 데이터 매니저 (.bframe 파일 저장/로드)
  const fabricDrawingPersistenceStore = createFabricDrawingPersistenceStore();
  const reviewDataManager = new ReviewDataManager({
    commentManager,
    drawingManager,
    highlightManager,
    compositionLayerManager,
    fabricDrawingPersistenceProvider: fabricDrawingPersistenceStore,
    autoSave: true,
    autoSaveDelay: 500 // 500ms 디바운스
  });
  reviewDataManager.connect();

  // Liveblocks 실시간 협업 매니저
  const liveblocksManager = new LiveblocksManager();

  // 댓글/그리기/재생 동기화 매니저
  const commentSync = new CommentSync({ liveblocksManager, commentManager });
  const drawingSync = new DrawingSync({ liveblocksManager, drawingManager });
  const playbackSync = getPlaybackSync(liveblocksManager);

  // ReviewDataManager에 LiveblocksManager 연결
  reviewDataManager.setLiveblocksManager(liveblocksManager);
  reviewDataManager.setBeforeSaveHandler(prepareReviewFileBeforeSave);
  reviewDataManager.setInitialSaveConflictHandler(handleInitialReviewFileSaveConflict);

  // mpv 예기치 못한 중단(크래시/행) 복구 상태 - 같은 파일 mpv 재시도는 1회만
  let mpvUnexpectedStopRecovery = { filePath: null, attempted: false };
  let isAppShuttingDown = false;

  // 앱 종료/새로고침 시 정리
  window.addEventListener('beforeunload', () => {
    isAppShuttingDown = true;
    void stopDeferredReviewFileDiscovery();
    // Liveblocks Room 퇴장 시 Presence 자동 정리됨
    liveblocksManager.releaseAllEditingLocks();
    // 모든 파일 감시 중지 (누적 방지)
    window.electronAPI.watchFileStopAll();
  });

  // ====== 최근 파일 매니저 초기화 ======
  const recentFilesManager = getRecentFilesManager();

  // 빈 상태 & 드롭다운 재렌더링 헬퍼
  function renderRecentFiles() {
    const items = recentFilesManager.getCached();
    recentFilesView.renderEmptyState(elements.recentFilesSection, items);
    if (elements.recentDropdownMenu.classList.contains('open')) {
      recentFilesView.renderDropdown(elements.recentDropdownMenu, items);
    }
  }

  // 공통 핸들러 (빈 상태와 드롭다운 둘 다 공유)
  const recentHandlers = {
    onOpen: async ({ path, missing }) => {
      if (missing) {
        if (confirm('파일을 찾을 수 없습니다. 목록에서 제거할까요?')) {
          const items = recentFilesManager.getCached();
          const match = items.find(i => i.path === path);
          if (match) await recentFilesManager.remove(match.id);
        }
        return;
      }
      // 드롭다운 닫기
      elements.recentDropdownMenu.classList.remove('open');
      elements.btnRecentFiles?.classList.remove('active');
      await openSelectedPath(path);
    },
    onPin: async (id) => {
      try {
        await recentFilesManager.togglePin(id);
      } catch (err) {
        showToast(err.message || '고정 실패', 'error');
      }
    },
    onRemove: async (id) => {
      await recentFilesManager.remove(id);
    },
    onClearAll: async () => {
      if (confirm('최근 파일 목록을 모두 지울까요?')) {
        await recentFilesManager.clear();
      }
    },
    onLoadMore: () => {
      showToast('더 많은 항목은 헤더의 최근 파일 버튼에서 확인하세요.', 'info');
    },
    onOpenOther: async () => {
      elements.recentDropdownMenu.classList.remove('open');
      elements.btnRecentFiles?.classList.remove('active');
      try {
        const result = await window.electronAPI.openFileDialog();
        if (!result.canceled && result.filePaths.length > 0) {
          await openSelectedPath(result.filePaths[0]);
        }
      } catch (error) {
        showToast('파일을 열 수 없습니다.', 'error');
      }
    }
  };

  // 이벤트 위임 바인딩 (두 컨테이너 모두)
  if (elements.recentFilesSection) {
    recentFilesView.bindEvents(elements.recentFilesSection, recentHandlers);
  }
  if (elements.recentDropdownMenu) {
    recentFilesView.bindEvents(elements.recentDropdownMenu, recentHandlers);
  }

  // 매니저 updated 이벤트 구독
  recentFilesManager.addEventListener('updated', renderRecentFiles);

  // 초기 로드
  recentFilesManager.refresh();

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
    state.videoCenterLocked = userSettings.getVideoCenterLocked();
    updateVideoCenterLockButton();
    applyVideoZoom();
  });

  // ====== 모듈 이벤트 연결 ======
  let lastFrameConsumerSyncFrame = null;

  // 비디오 메타데이터 로드됨
  videoPlayer.addEventListener('loadedmetadata', (e) => {
    const { duration, totalFrames, fps } = e.detail;
    lastFrameConsumerSyncFrame = null;
    timeline.setVideoInfo(duration, fps);
    compositionLayerManager.setVideoInfo({ duration });
    if (!shouldIgnoreContinuousTimelineUpdateDuringSourceLoad()) {
      updateTimecodeDisplay();
    }

    // 비디오 크기 정보가 준비되면 캔버스 오버레이 동기화
    syncCanvasOverlay();

    // 드로잉 매니저에 비디오 정보 전달
    drawingManager.setVideoInfo(totalFrames, fps);

    // 댓글 매니저에 FPS 전달
    commentManager.setFPS(fps);
    reviewDataManager.setFps(fps);

    // .bframe에서 로드된 데이터가 있으면 다시 렌더링
    if (drawingManager.layers.length > 0) {
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      drawingManager.renderFrame(videoPlayer.currentFrame);
    }

    // 댓글 마커도 다시 렌더링 (FPS 설정 후)
    renderVideoMarkers();
    updateTimelineMarkers();
    renderCompositionLayerTimeline();

    log.info('비디오 정보', { duration, totalFrames, fps });
  });

  function syncPlaybackPositionUI(currentTime, currentFrame, options = {}) {
    const {
      updatePresence = false,
      updateDrawing = false
    } = options;

    if (!shouldIgnoreContinuousTimelineUpdateDuringSourceLoad()) {
      timeline.setCurrentTime(getActiveTimelinePlaybackTime(currentTime, currentFrame));
      updateTimecodeDisplay();
      updateFullscreenTimecode();
      updateFullscreenSeekbar();
    }

    if (state.isAudioMode) {
      const audioWaveform = getAudioWaveform();
      audioWaveform.updateTime(currentTime);
      audioWaveform.setPlaying(videoPlayer.isPlaying);
    }

    const shouldSyncFrameConsumers = !videoPlayer.isPlaying || currentFrame !== lastFrameConsumerSyncFrame;
    if (shouldSyncFrameConsumers) {
      lastFrameConsumerSyncFrame = currentFrame;
      commentManager.setCurrentFrame(currentFrame);
      void handleCutlistPlaybackFrame(currentFrame);
      refreshCurrentCutFromPlayback(currentFrame);
    }

    if (updatePresence && liveblocksManager.isConnected) {
      liveblocksManager.updatePresence({ currentFrame });
    }

    if (typeof updateVideoCommentPlayhead === 'function') {
      updateVideoCommentPlayhead();
    }

    syncCompositionLayerPlaybackState(currentTime, videoPlayer.isPlaying);

    if (updateDrawing) {
      drawingManager.setCurrentFrame(currentFrame);
    }
  }

  function syncCompositionLayerPlaybackState(currentTime, isPlaying) {
    const safeCurrentTime = Number.isFinite(Number(currentTime))
      ? Number(currentTime)
      : videoPlayer.currentTime;
    compositionLayerManager.setPlaybackState({
      currentTime: safeCurrentTime,
      isPlaying
    });

    if (
      document.body.classList.contains('mpv-pilot-mode') &&
      compositionLayerManager.toJSON().length > 0
    ) {
      scheduleMpvOverlayStateSync({ force: true });
    }
  }

  // 비디오 시간 업데이트 (일반 timeupdate - 타임라인 및 표시용)
  videoPlayer.addEventListener('timeupdate', (e) => {
    const { currentTime, currentFrame } = e.detail;
    syncPlaybackPositionUI(currentTime, currentFrame, {
      updatePresence: true,
      updateDrawing: !videoPlayer.isPlaying
    });
    scheduleFabricPilotStatusRefresh();
    if (
      isMpvReviewInteractionActive() &&
      isMpvPilotPlaybackActive() &&
      !elements.drawingTools?.classList.contains('playback-hidden') &&
      invalidateMpvReviewFreezeForFrameChange()
    ) {
      scheduleMpvReviewFreezeRefresh();
    }
  });

  // 프레임 정확한 업데이트 (requestVideoFrameCallback 기반 - 재생 중 표시/그리기 동기화용)
  videoPlayer.addEventListener('frameUpdate', (e) => {
    const { frame, time } = e.detail;

    syncPlaybackPositionUI(time, frame, {
      updatePresence: false,
      updateDrawing: true
    });
    scheduleFabricPilotStatusRefresh();
    if (
      isMpvReviewInteractionActive() &&
      isMpvPilotPlaybackActive() &&
      !elements.drawingTools?.classList.contains('playback-hidden')
    ) {
      invalidateMpvReviewFreezeForFrameChange();
      scheduleMpvReviewFreezeRefresh();
    }
  });

  // 재생 아이콘 SVG
  const playIconSVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  const pauseIconSVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

  // 비디오 재생 상태 변경
  videoPlayer.addEventListener('play', () => {
    elements.btnPlay.innerHTML = pauseIconSVG;
    scheduleFabricPilotStatusRefresh({ force: true });
    drawingManager.setPlaying(true);
    timeline.setPlayingState(true);
    syncCompositionLayerPlaybackState(videoPlayer.currentTime, true);
    getAudioWaveform()?.setPlaying(true);
    // 재생 시작 시 플레이헤드가 화면 밖에 있으면 스크롤
    timeline.scrollToPlayhead();
    // 재생 중에는 온디맨드 썸네일 캡처를 중단해 재생 방해를 방지
    getThumbnailGenerator()?._abortExactDrain?.();
    // 피드백 25: 재생 중에는 공용 리뷰 freeze를 해제해 mpv 영상을 표시한다.
    // 패널은 즉시 감추고, release가 호스트 복원을 확인한 뒤 freeze를 제거하므로
    // 정지 화면과 실제 영상 사이에 검은 구간이 생기지 않는다.
    if (
      state.isDrawMode &&
      !fabricDrawingPilotController.isActiveOrPreparing() &&
      isMpvPilotPlaybackActive()
    ) {
      mpvDrawPlaybackTransitionToken += 1;
      elements.drawingTools?.classList.add('playback-hidden');
      scheduleMpvOverlayStateSync({ force: true });
      void releaseMpvReviewFreezeFrame();
    }
  });

  videoPlayer.addEventListener('pause', () => {
    elements.btnPlay.innerHTML = playIconSVG;
    scheduleFabricPilotStatusRefresh({ force: true });
    drawingManager.setPlaying(false);
    timeline.setPlayingState(false);
    syncCompositionLayerPlaybackState(videoPlayer.currentTime, false);
    getAudioWaveform()?.setPlaying(false);
    // 일시정지 시점에 누적된 온디맨드 정확-프레임 큐를 소진
    getThumbnailGenerator()?._drainExactQueue?.();
    if (
      state.isDrawMode &&
      !fabricDrawingPilotController.isActiveOrPreparing() &&
      isMpvPilotPlaybackActive() &&
      elements.drawingTools?.classList.contains('playback-hidden')
    ) {
      void restoreMpvDrawFreezeAfterPlayback();
    }
  });

  videoPlayer.addEventListener('ended', () => {
    elements.btnPlay.innerHTML = playIconSVG;
    scheduleFabricPilotStatusRefresh({ force: true });
    drawingManager.setPlaying(false);
    timeline.setPlayingState(false);
    syncCompositionLayerPlaybackState(videoPlayer.currentTime, false);
    getAudioWaveform()?.setPlaying(false);

    if (
      state.isDrawMode &&
      !fabricDrawingPilotController.isActiveOrPreparing() &&
      isMpvPilotPlaybackActive() &&
      elements.drawingTools?.classList.contains('playback-hidden')
    ) {
      void restoreMpvDrawFreezeAfterPlayback();
    }

    if (cutlistUIState.active && getCutlistManager().isActive()) {
      const currentCut = getCutlistManager().getCutById(getCutlistManager().currentCutId);
      if (currentCut && getNextCutlistCut(currentCut)) {
        log.info('컷 묶음 재생: 다음 컷으로 이동');
        void advanceCutlistPlaybackFromCut(currentCut);
        return;
      }
    }

    const playlistManager = getPlaylistManager();
    if (continuousPlaybackState.active) {
      if (!hasContinuousPlaybackReachedMediaEnd()) {
        log.warn('타임라인 이어붙이기: 영상 끝이 아닌 종료 신호를 무시합니다', getContinuousPlaybackSnapshot());
        return;
      }
      log.info('타임라인 이어붙이기: 다음 재생 가능 항목으로 이동');
      void playNextContinuousItem(continuousPlaybackState.sessionId);
      return;
    }

    if (playlistManager.isActive() && userSettings.getPlaylistAutoPlay() && playlistManager.hasNext()) {
      log.info('자동 재생: 다음 아이템으로 이동');
      playlistAutoPlayAfterSelection = true;
      const nextItem = playlistManager.next();
      if (!nextItem) {
        playlistAutoPlayAfterSelection = false;
      }
    }
  });

  // 비디오 에러
  videoPlayer.addEventListener('error', (e) => {
    const errorDetail = e.detail?.error;
    const code = errorDetail?.code;
    const message = errorDetail?.message || '';

    // PIPELINE_ERROR_DECODE (code 3): 오디오 패킷 디코딩 실패는 비치명적
    // 비디오는 정상 재생되므로 토스트를 표시하지 않음
    if (code === 3 && message.includes('audio')) {
      log.warn('오디오 디코딩 에러 (비치명적, 무시)', { code, message });
      return;
    }

    showToast('비디오 재생 오류가 발생했습니다.', 'error');
  });

  videoPlayer.addEventListener('externalstopped', (e) => {
    elements.videoWrapper?.classList.remove('mpv-pilot-mode');
    document.body.classList.remove('mpv-pilot-mode');
    mpvHostLastRequestedVisible = null;

    const detail = e.detail || {};
    const stoppedFilePath = detail.filePath || state.currentFile;
    if (consumeExpectedMpvHtml5FallbackStop(stoppedFilePath)) {
      log.info('의도한 HTML5 전환 중 mpv 중단 신호를 소비했습니다.', { stoppedFilePath });
      return;
    }

    // 앱 종료 중 main의 mpv 정리를 크래시로 오인해 재기동하는 레이스 방지
    if (isAppShuttingDown) return;
    // mpv 재기동/파일 전환 중 폴링이 감지한 일시적 stopped는 복구 대상이 아님
    if (mpvPilotHostPreparing) return;

    if (hasActiveVideoLoadForDifferentFile(stoppedFilePath)) return;
    if (!stoppedFilePath || !isSameFilePath(stoppedFilePath, state.currentFile)) return;

    const retryMpv = !mpvUnexpectedStopRecovery.attempted ||
      !isSameFilePath(mpvUnexpectedStopRecovery.filePath, stoppedFilePath);
    mpvUnexpectedStopRecovery = { filePath: stoppedFilePath, attempted: true };

    const resumeFrame = Number.isFinite(Number(detail.lastFrame)) ? Number(detail.lastFrame) : null;
    showToast(
      retryMpv
        ? 'mpv 재생이 중단되어 영상을 다시 불러옵니다.'
        : 'mpv 재생이 반복 중단되어 기존 변환 방식으로 다시 불러옵니다.',
      'warning',
      null,
      true
    );
    log.warn('mpv 예기치 못한 중단, 자동 복구', { reason: detail.reason, retryMpv, resumeFrame });
    void loadVideo(stoppedFilePath, {
      keepVersionContext: true,
      allowMpvPilot: retryMpv,
      initialFrame: resumeFrame,
      playWhenMediaReady: false
    });
  });

  // 코덱 미지원
  const codecErrorOverlay = document.getElementById('codecErrorOverlay');
  const btnCodecErrorClose = document.getElementById('btnCodecErrorClose');

  videoPlayer.addEventListener('codecunsupported', (e) => {
    // 오디오 모드에서는 videoWidth=0이 정상이므로 무시
    if (state.isAudioMode) return;
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
  timeline.addEventListener('seek', async (e) => {
    if (playlistUIState.mode === 'continuous' && timeline.playlistDuration > 0) {
      await seekContinuousTimeline(e.detail.time);
      hideScrubPreview();
      return;
    }

    if (cutlistUIState.active && getCutlistManager().isActive() && timeline.cutlistDuration > 0) {
      await seekCutlistTimeline(e.detail.time);
      hideScrubPreview();
      return;
    }

    videoPlayer.seek(e.detail.time);
    playbackSync.broadcastSeek(e.detail.time);
    hideScrubPreview();
  });

  timeline.addEventListener('cutlist-seek', (e) => {
    getCutlistManager().selectCut(e.detail.cutId);
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
    scheduleMpvOverlayStateSync();
  });

  drawingManager.addEventListener('drawstart', () => {
    scheduleMpvOverlayStateSync();
  });

  drawingManager.addEventListener('drawmove', () => {
    scheduleMpvOverlayStateSync({ liveDrawing: true });
  });

  drawingManager.addEventListener('selectionoverlaychanged', () => {
    scheduleMpvOverlayStateSync({ liveDrawing: true });
  });

  drawingManager.addEventListener('drawend', () => {
    scheduleMpvOverlayStateSync({ force: true });
  });

  drawingManager.addEventListener('drawblocked', (e) => {
    const reason = e.detail?.reason;
    const message = reason === 'hidden'
      ? '숨긴 레이어에는 그릴 수 없습니다. 레이어를 보이게 켠 뒤 다시 시도하세요.'
      : '잠긴 레이어에는 그릴 수 없습니다. 잠금을 해제한 뒤 다시 시도하세요.';
    showToast(message, 'warning');
  });

  drawingManager.addEventListener('strokeeraserunavailable', () => {
    showToast('픽셀 지우개로 편집된 그림은 획 단위로 지울 수 없습니다. 픽셀 지우개로 지우거나 새로 그린 획을 지워주세요.', 'warning');
  });

  // 프레임 렌더링 완료 시
  drawingManager.addEventListener('frameRendered', (e) => {
    log.debug('프레임 렌더링 완료', { frame: e.detail.frame });
    scheduleMpvOverlayStateSync();
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

  // ====== 레이어 설정 팝업 (우클릭 말풍선) ======

  const layerSettingsPopup = document.getElementById('layerSettingsPopup');
  const layerSettingsArrow = layerSettingsPopup.querySelector('.layer-settings-arrow');
  const layerNameInput = document.getElementById('layerNameInput');
  const layerColorPicker = document.getElementById('layerColorPicker');
  const layerOpacitySlider = document.getElementById('layerOpacitySlider');
  const layerOpacityValue = document.getElementById('layerOpacityValue');
  const layerDeleteBtn = document.getElementById('layerDeleteBtn');
  let selectedLayerIdForPopup = null;

  function showLayerSettingsPopup(layerId, x, y) {
    const layer = drawingManager.layers.find(l => l.id === layerId);
    if (!layer) return;

    selectedLayerIdForPopup = layerId;

    // 입력값 설정
    layerNameInput.value = layer.name || '';
    layerOpacitySlider.value = Math.round((layer.opacity ?? 1) * 100);
    layerOpacityValue.textContent = `${layerOpacitySlider.value}%`;

    // 색상 버튼 선택 상태
    layerColorPicker.querySelectorAll('.layer-color-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.color === layer.color);
    });

    // 팝업 크기 측정을 위해 임시 표시
    layerSettingsPopup.style.display = 'block';
    layerSettingsPopup.style.visibility = 'hidden';

    requestAnimationFrame(() => {
      const popupRect = layerSettingsPopup.getBoundingClientRect();
      const popupWidth = popupRect.width;
      const popupHeight = popupRect.height;

      // 화면 경계 고려하여 위치 조정
      let popupX = x - 30;
      let popupY = y + 12;

      // 오른쪽 넘침 방지
      if (popupX + popupWidth > window.innerWidth - 10) {
        popupX = window.innerWidth - popupWidth - 10;
      }
      // 왼쪽 넘침 방지
      if (popupX < 10) popupX = 10;

      // 아래쪽 넘침 → 위쪽에 표시
      if (popupY + popupHeight > window.innerHeight - 10) {
        popupY = y - popupHeight - 12;
        // 화살표를 아래로 이동
        layerSettingsArrow.style.top = '';
        layerSettingsArrow.style.bottom = '-6px';
        layerSettingsArrow.style.transform = 'rotate(225deg)';
      } else {
        layerSettingsArrow.style.top = '-6px';
        layerSettingsArrow.style.bottom = '';
        layerSettingsArrow.style.transform = 'rotate(45deg)';
      }

      // 화살표 위치 (클릭 위치 기준)
      const arrowLeft = Math.max(12, Math.min(x - popupX, popupWidth - 24));
      layerSettingsArrow.style.left = `${arrowLeft}px`;

      layerSettingsPopup.style.left = `${popupX}px`;
      layerSettingsPopup.style.top = `${popupY}px`;
      layerSettingsPopup.style.visibility = '';
    });
  }

  function hideLayerSettingsPopup() {
    layerSettingsPopup.style.display = 'none';
    selectedLayerIdForPopup = null;
  }

  // 레이어 우클릭 → 팝업 표시
  timeline.addEventListener('layerContextMenu', (e) => {
    const { layerId, x, y } = e.detail;
    showLayerSettingsPopup(layerId, x, y);
  });

  // 팝업 외부 클릭 시 닫기
  document.addEventListener('pointerdown', (e) => {
    if (layerSettingsPopup.style.display === 'block' &&
        !layerSettingsPopup.contains(e.target) &&
        !e.target.closest('.drawing-layer-header')) {
      hideLayerSettingsPopup();
    }
  });

  // 레이어 이름 변경
  layerNameInput.addEventListener('input', () => {
    if (selectedLayerIdForPopup) {
      drawingManager.setLayerName(selectedLayerIdForPopup, layerNameInput.value);
    }
  });

  // 레이어 색상 변경
  layerColorPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('.layer-color-btn');
    if (!btn || !selectedLayerIdForPopup) return;

    const color = btn.dataset.color;
    drawingManager.setLayerColor(selectedLayerIdForPopup, color);

    // 선택 상태 갱신
    layerColorPicker.querySelectorAll('.layer-color-btn').forEach(b => {
      b.classList.toggle('selected', b === btn);
    });
  });

  // 레이어 불투명도 변경 (팝업 슬라이더)
  layerOpacitySlider.addEventListener('input', () => {
    if (!selectedLayerIdForPopup) return;
    const val = parseInt(layerOpacitySlider.value);
    layerOpacityValue.textContent = `${val}%`;
    drawingManager.setLayerOpacity(selectedLayerIdForPopup, val / 100);

    // 헤더의 불투명도 배지도 실시간 업데이트
    const badge = document.querySelector(
      `.drawing-layer-header[data-layer-id="${selectedLayerIdForPopup}"] .layer-opacity-badge`
    );
    if (badge) badge.textContent = `${val}%`;
  });

  layerDeleteBtn.addEventListener('click', () => {
    deleteDrawingLayer(selectedLayerIdForPopup);
  });

  // 키프레임 이동
  timeline.addEventListener('keyframesMove', (e) => {
    const { keyframes, frameDelta, anchor } = e.detail;
    if (drawingManager.moveKeyframes(keyframes)) {
      // 이동 성공 시 선택 상태 업데이트
      const movedSelection = keyframes.map(kf => ({
        layerId: kf.layerId,
        frame: kf.toFrame
      }));
      timeline.setKeyframeSelection(movedSelection, { anchor });
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      showToast(`키프레임 ${frameDelta > 0 ? '+' : ''}${frameDelta} 프레임 이동`, 'info');
    }
  });

  function deleteSelectedOrCurrentKeyframes() {
    const selectedKeyframes = Array.isArray(timeline.selectedKeyframes)
      ? timeline.selectedKeyframes
      : [];

    if (selectedKeyframes.length > 0) {
      const removedCount = drawingManager.removeKeyframes(selectedKeyframes);
      if (removedCount > 0) {
        timeline.clearSelection();
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
        showToast(`키프레임 ${removedCount}개가 삭제되었습니다.`, 'info');
      } else {
        showToast('삭제할 수 있는 선택 키프레임이 없습니다.', 'warn');
      }
      return removedCount > 0;
    }

    const removed = drawingManager.removeKeyframe();
    if (removed) {
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      showToast('키프레임이 삭제되었습니다.', 'info');
    } else {
      showToast('삭제할 키프레임이 없습니다.', 'warn');
    }
    return removed;
  }

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

    // pendingCommentFocus는 updateCommentListImmediate에서 처리
  });

  // 로드 에러
  reviewDataManager.addEventListener('loadError', (e) => {
    log.error('.bframe 로드 실패', e.detail.error);
    showToast('리뷰 데이터 로드 실패', 'error');
  });

  // ====== 댓글 매니저 이벤트 (마커 기반) ======

  let commentModePreparationToken = 0;
  let drawModePreparationToken = 0;
  let suppressReviewFreezeReleaseForMediaChange = false;

  function setCommentModeReadyState(ready) {
    elements.videoWrapper.classList.toggle('comment-mode', ready);
    markerContainer.style.pointerEvents = ready ? 'auto' : 'none';
    markerContainer.style.zIndex = ready ? '30' : '15';
    elements.btnAddComment?.classList.toggle('active', ready);
  }

  function setCommentModePreparingState(preparing) {
    elements.videoWrapper?.classList.toggle('comment-mode-preparing', preparing);
    elements.btnAddComment?.classList.toggle('preparing', preparing);
    elements.btnAddComment?.setAttribute('aria-busy', String(preparing));
  }

  function showCommentModeGuidance() {
    // pendingText가 있으면 토스트 생략 (역순 플로우에서는 Enter 핸들러가 토스트 표시)
    if (!commentManager.getPendingText()) {
      showToast('댓글 모드: 영상을 클릭하여 댓글을 추가하세요', 'info');
    }
  }

  async function prepareMpvCommentMode(preparationToken) {
    return prepareMpvCommentReadiness({
      prepareFreeze: () => showMpvReviewFreezeFrame(),
      isStillActive: () => (
        preparationToken === commentModePreparationToken &&
        state.isCommentMode &&
        isMpvPilotPlaybackActive()
      ),
      setReady: setCommentModeReadyState,
      setPreparing: setCommentModePreparingState,
      showGuidance: showCommentModeGuidance
    });
  }

  // 댓글 모드 변경
  commentManager.addEventListener('commentModeChanged', (e) => {
    const { isCommentMode } = e.detail;
    const preparationToken = ++commentModePreparationToken;
    state.isCommentMode = isCommentMode;
    if (isCommentMode && (state.isDrawMode || isFabricDrawingPilotControllerEngaged())) {
      exitDrawModeForSystemPath();
    }

    // 커서 변경
    if (isCommentMode) {
      if (isMpvPilotPlaybackActive()) {
        videoPlayer.pause();
        // 작업 4: 하이브리드 우선 — 성공 시 직접 ready, 실패 시 기존 freeze 준비로 폴백.
        // (c-0)의 skipReviewTransition 없이는 전이 헬퍼가 댓글 모드를 강제 종료해 자멸한다.
        void enterHybridReviewEngineIfPossible().then((swapped) => {
          // 전환 중 사용자가 모드를 껐으면 mpv 복귀만 정리
          if (!state.isCommentMode) {
            void exitHybridReviewEngineIfNeeded();
            return;
          }
          if (swapped) {
            setCommentModePreparingState(false);
            setCommentModeReadyState(true);
            showCommentModeGuidance();
          } else {
            void prepareMpvCommentMode(preparationToken);
          }
        });
      } else {
        setCommentModePreparingState(false);
        setCommentModeReadyState(true);
        showCommentModeGuidance();
      }
    } else {
      setCommentModePreparingState(false);
      setCommentModeReadyState(false);
      removePendingMarkerUI();
      if (!isMpvReviewInteractionActive() && !suppressReviewFreezeReleaseForMediaChange) {
        void releaseMpvReviewFreezeFrame();
      }
      void exitHybridReviewEngineIfNeeded();
    }
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
  commentManager.addEventListener('markerAdded', async (e) => {
    const { marker, remote, restored, imported } = e.detail;
    removePendingMarkerUI();
    renderVideoMarkers();
    updateTimelineMarkers();
    updateCommentList();
    log.info('마커 추가됨', { id: marker.id, text: marker.text, remote: !!remote });

    // 원격 변경, Redo 복원, 가져온 피드백은 알림/Undo 스킵
    if (remote || restored || imported) return;

    // Slack 알림: @멘션 대상에게 웹훅 전송 (딥링크 전에 저장하여 최신 상태 보장)
    if (reviewDataManager.getBframePath()) {
      const saved = await reviewDataManager.save();
      if (!saved) {
        log.warn('bframe 저장 실패, Slack 알림 건너뜀');
        return;
      }
    }
    slackNotifier.notifyNewComment(marker, commentManager.getAuthor(), {
      filePath: state.currentFile,
      bframePath: reviewDataManager.getBframePath() || '',
      fileName: elements.fileName?.textContent || '',
      timecode: marker.startTimecode || ''
    });

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

    // Slack 알림: 원작성자 + 스레드 참여자에게 웹훅 전송
    // remote: true인 경우(다른 사용자로부터 동기화된 답글)는 알림 전송 안 함
    const { marker, reply, remote } = e.detail;
    if (marker && reply && !remote) {
      // 딥링크 전에 저장하여 최신 상태 보장
      const sendReplyNotification = async () => {
        if (reviewDataManager.getBframePath()) {
          const saved = await reviewDataManager.save();
          if (!saved) {
            log.warn('bframe 저장 실패, 답글 Slack 알림 건너뜀');
            return;
          }
        }
        slackNotifier.notifyReply(marker, reply, commentManager.getAuthor(), {
          filePath: state.currentFile,
          bframePath: reviewDataManager.getBframePath() || '',
          fileName: elements.fileName?.textContent || '',
          timecode: marker.startTimecode || ''
        });
      };
      sendReplyNotification();
    }
  });

  // 원격 동기화로 인한 전체 갱신 (CommentSync의 fromJSON 호출 시)
  commentManager.addEventListener('markersChanged', () => {
    renderVideoMarkers();
    updateTimelineMarkers();
    updateCommentList();
    if (getPlaylistManager().isActive?.()) {
      void refreshVisiblePlaylistProgress();
    }
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

  // 권한 없음 이벤트
  commentManager.addEventListener('permissionDenied', (e) => {
    const { action } = e.detail;
    const actionLabel = action === 'delete' ? '삭제' : action === 'deleteReply' ? '삭제' : '수정';
    showToast(`본인 ${action.includes('Reply') ? '답글' : '코멘트'}만 ${actionLabel}할 수 있습니다.`, 'warning');
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
    renderCompositionLayerTimeline();
  });

  function renderCompositionLayerTimeline() {
    timeline.renderCompositionLayers(compositionLayerManager.toJSON(), {
      selectedLayerId: compositionLayerManager.selectedLayerId,
      duration: videoPlayer.duration || timeline.duration || 0
    });
  }

  function getPathShareRoot(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const unc = normalized.match(/^\/\/([^/]+)\/([^/]+)/);
    if (unc) return `//${unc[1].toLowerCase()}/${unc[2].toLowerCase()}`;
    const drive = normalized.match(/^([a-zA-Z]):\//);
    if (drive) return `${drive[1].toUpperCase()}:`;
    return '';
  }

  async function addCompositionLayerFromPath(filePath) {
    if (!videoPlayer.isLoaded) {
      showToast('먼저 기준 영상을 열어주세요.', 'warning');
      return null;
    }
    const layer = await compositionLayerManager.addLayerFromFile(filePath);
    if (layer) {
      compositionLayerManager.togglePanel(true);
      renderCompositionLayerTimeline();
      scheduleMpvOverlayStateSync({ force: true });
      const layerRoot = getPathShareRoot(filePath);
      const baseRoot = getPathShareRoot(videoPlayer.filePath);
      if (layerRoot && baseRoot && layerRoot !== baseRoot) {
        showToast('기준 영상과 다른 드라이브의 파일이라 다른 팀원에게는 보이지 않을 수 있어요.', 'warn', 6000);
      } else {
        showToast('합성 레이어가 추가되었습니다.', 'success');
      }
    }
    return layer;
  }

  async function chooseDroppedVideoAction(filePath) {
    const name = String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || '드롭한 영상';
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'composition-drop-choice-overlay';
      overlay.innerHTML = `
        <div class="composition-drop-choice-dialog" role="dialog" aria-modal="true" aria-label="드롭한 영상 처리 선택">
          <div class="composition-drop-choice-title">드롭한 영상 처리</div>
          <div class="composition-drop-choice-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="composition-drop-choice-actions">
            <button type="button" data-action="open">기준 영상으로 열기</button>
            <button type="button" class="primary" data-action="overlay">합성 레이어로 얹기</button>
            <button type="button" data-action="cancel">취소</button>
          </div>
        </div>
      `;

      const cleanup = (action) => {
        window.removeEventListener('keydown', handleKeyDown);
        overlay.remove();
        resolve(action);
      };
      const handleKeyDown = (event) => {
        if (event.key === 'Escape') cleanup('cancel');
      };

      overlay.addEventListener('click', (event) => {
        const action = event.target.closest?.('[data-action]')?.dataset.action;
        if (action) {
          cleanup(action);
          return;
        }
        if (event.target === overlay) cleanup('cancel');
      });
      window.addEventListener('keydown', handleKeyDown);
      document.body.appendChild(overlay);
      overlay.querySelector('[data-action="overlay"]')?.focus();
    });
  }

  elements.btnLayerCompositing?.addEventListener('click', () => {
    compositionLayerManager.togglePanel();
  });

  compositionLayerManager.addEventListener('changed', () => {
    renderCompositionLayerTimeline();
    scheduleMpvOverlayStateSync({ force: true });
  });

  compositionLayerManager.addEventListener('selectionChanged', () => {
    renderCompositionLayerTimeline();
    scheduleMpvOverlayStateSync({ force: true });
  });

  timeline.addEventListener('compositionLayerSelect', (e) => {
    compositionLayerManager.selectLayer(e.detail.layerId);
  });

  timeline.addEventListener('compositionLayerVisibilityToggle', (e) => {
    const layer = compositionLayerManager.getLayer(e.detail.layerId);
    if (layer) compositionLayerManager.updateLayer(layer.id, { enabled: !layer.enabled });
  });

  timeline.addEventListener('compositionLayerReorder', (e) => {
    const { layerId, targetLayerId, placement } = e.detail || {};
    if (layerId && targetLayerId) {
      compositionLayerManager.reorderLayerByDisplayTarget(layerId, targetLayerId, placement);
    }
  });

  timeline.addEventListener('compositionLayerRangeChange', (e) => {
    const { layerId, mode, clientX, trackWidth } = e.detail;
    compositionLayerManager.selectLayer(layerId);
    compositionLayerManager.startTimelineRangeDrag(layerId, mode, clientX, trackWidth);
  });

  // ====== 이벤트 리스너 설정 ======

  // 파일 열기 버튼
  elements.btnOpenFile?.addEventListener('click', async () => {
    log.info('파일 열기 버튼 클릭');
    try {
      const result = await window.electronAPI.openFileDialog();
      if (!result.canceled && result.filePaths.length > 0) {
        await openSelectedPath(result.filePaths[0]);
      }
    } catch (error) {
      log.error('파일 열기 실패', error);
      showToast('파일을 열 수 없습니다.', 'error');
    }
  });

  // 헤더 최근 파일 버튼 토글
  elements.btnRecentFiles?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = elements.recentDropdownMenu;
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
      menu.classList.remove('open');
      elements.btnRecentFiles.classList.remove('active');
    } else {
      recentFilesView.renderDropdown(menu, recentFilesManager.getCached());
      menu.classList.add('open');
      elements.btnRecentFiles.classList.add('active');
    }
  });

  // 바깥 클릭으로 드롭다운 닫기
  document.addEventListener('click', (e) => {
    const menu = elements.recentDropdownMenu;
    if (!menu || !menu.classList.contains('open')) return;
    if (menu.contains(e.target)) return;
    if (elements.btnRecentFiles?.contains(e.target)) return;
    menu.classList.remove('open');
    elements.btnRecentFiles?.classList.remove('active');
  });

  // Esc로 드롭다운 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.recentDropdownMenu?.classList.contains('open')) {
      elements.recentDropdownMenu.classList.remove('open');
      elements.btnRecentFiles?.classList.remove('active');
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
        await openSelectedPath(result.filePaths[0]);
      }
    } catch (error) {
      log.error('파일 열기 실패', error);
      showToast('파일을 열 수 없습니다.', 'error');
    }
  });

  // 드롭된 파일 열기 (드롭존·문서 레벨 공용) — 기존 dropZone drop 분기를 그대로 이동
  async function handleDroppedFiles(files) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (isPlaylistFilePath(file.path || file.name)) {
      await openPlaylistFile(file.path);
    } else if (isCutlistFilePath(file.path || file.name)) {
      await openCutlistFile(file.path);
    } else if (videoPlayer.isLoaded && isVideoFile(file.path || file.name)) {
      const videoAction = await chooseDroppedVideoAction(file.path);
      if (videoAction === 'overlay') {
        await addCompositionLayerFromPath(file.path);
      } else if (videoAction === 'open') {
        await loadVideo(file.path);
      }
    } else if (videoPlayer.isLoaded && isCompositionLayerFile(file.path || file.name)) {
      await addCompositionLayerFromPath(file.path);
    } else if (isMediaFile(file.name)) {
      await loadVideo(file.path);
    } else {
      showToast('지원하지 않는 파일 형식입니다.', 'error');
    }
  }

  // 드래그 앤 드롭
  elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    // 재생목록 사이드바가 열려있고 드래그가 그 위에서 발생하면 메인 드롭존 비활성화
    const playlistSidebar = elements.playlistSidebar;
    if (playlistSidebar && !playlistSidebar.classList.contains('hidden')) {
      const rect = playlistSidebar.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        elements.dropZone.classList.remove('dragging');
        return;
      }
    }
    elements.dropZone.classList.add('dragging');
  });

  elements.dropZone.addEventListener('dragleave', () => {
    elements.dropZone.classList.remove('dragging');
  });

  elements.dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    elements.dropZone.classList.remove('dragging');

    // 재생목록 사이드바 위에서 드롭된 경우 무시 (사이드바에서 처리)
    const playlistSidebar = elements.playlistSidebar;
    if (playlistSidebar && !playlistSidebar.classList.contains('hidden')) {
      const rect = playlistSidebar.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        return;
      }
    }

    await handleDroppedFiles(e.dataTransfer.files);
  });

  // 신규: 영상 로드 후에도(드롭존 숨김) 창 어디에나 드롭해 파일을 열 수 있게 한다.
  // preventDefault가 없으면 Electron 기본 동작이 페이지를 file:// 로 네비게이트한다.
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    // 내부 HTML5 드래그(재생목록 정렬·키프레임 드래그)의 커서 피드백을 덮지 않도록 파일 드래그에만 적용
    if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    // 재생목록 사이드바/추가영역의 자체 핸들러는 stopPropagation으로 여기 오지 않는다.
    // 드롭존이 보이는 상태(첫 화면)면 드롭존 핸들러가 이미 처리했으므로 중복 방지.
    if (!elements.dropZone.classList.contains('hidden')) return;
    void handleDroppedFiles(e.dataTransfer?.files);
  });

  // 클립보드 이미지 붙여넣기 → 합성 레이어 임베드 (피드백 38)
  document.addEventListener('paste', async (e) => {
    if (shouldIgnoreGlobalShortcutTarget(e.target)) return;
    if (!hasImageInClipboard(e)) return;
    if (!videoPlayer.isLoaded) {
      showToast('먼저 기준 영상을 열어주세요.', 'warning');
      return;
    }
    e.preventDefault();

    try {
      const image = await getImageFromClipboard(e);
      if (!image?.base64) {
        showToast('클립보드에서 이미지를 읽지 못했습니다.', 'error');
        return;
      }
      const layer = await compositionLayerManager.addLayerFromDataUrl(image.base64);
      if (layer) {
        compositionLayerManager.togglePanel(true);
        renderCompositionLayerTimeline();
        scheduleMpvOverlayStateSync({ force: true });
        showToast('클립보드 이미지를 합성 레이어로 추가했습니다.', 'success');
      }
    } catch (error) {
      log.error('클립보드 이미지 붙여넣기 실패', error);
      showToast('클립보드 이미지를 추가하지 못했습니다.', 'error');
    }
  });

  // 재생/일시정지
  elements.btnPlay.addEventListener('click', handleUserPlayPauseToggle);

  // 프레임 이동
  elements.btnFirst.addEventListener('click', () => videoPlayer.seekToStart());
  elements.btnPrevFrame.addEventListener('click', () => videoPlayer.prevFrame());
  elements.btnNextFrame.addEventListener('click', () => videoPlayer.nextFrame());
  elements.btnLast.addEventListener('click', () => videoPlayer.seekToEnd());

  // ====== 메인 뷰 볼륨 컨트롤 ======
  const btnMainMute = document.getElementById('btnMainMute');
  const mainVolumeSlider = document.getElementById('mainVolumeSlider');
  const mainVolumeIcon = document.getElementById('mainVolumeIcon');
  let lastVolumeBeforeMute = 1;

  const updateMainVolumeIcon = (muted) => {
    if (!mainVolumeIcon) return;
    if (muted) {
      mainVolumeIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
      btnMainMute?.classList.add('muted');
    } else {
      mainVolumeIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
      btnMainMute?.classList.remove('muted');
    }
  };

  btnMainMute?.addEventListener('click', () => {
    const muted = videoPlayer.toggleMute();
    updateMainVolumeIcon(muted);
    if (muted) {
      lastVolumeBeforeMute = videoPlayer.videoElement.volume || 1;
    } else if (mainVolumeSlider) {
      mainVolumeSlider.value = lastVolumeBeforeMute * 100;
      videoPlayer.setVolume(lastVolumeBeforeMute);
    }
  });

  mainVolumeSlider?.addEventListener('input', (e) => {
    const volume = e.target.value / 100;
    videoPlayer.setVolume(volume);
    if (volume === 0) {
      videoPlayer.setMuted(true);
      updateMainVolumeIcon(true);
    } else if (videoPlayer.videoElement.muted) {
      videoPlayer.setMuted(false);
      updateMainVolumeIcon(false);
    }
  });

  // 그리기 모드 토글
  elements.btnDrawMode.addEventListener('click', toggleDrawMode);

  // 댓글 추가 버튼 (댓글 모드 토글)
  elements.btnAddComment.addEventListener('click', () => {
    void (async () => {
      if (!state.isCommentMode && !(await ensureCutlistCommentTargetReady())) return;
      toggleCommentMode();
    })();
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

  // 사이드바 댓글 입력에 멘션 자동완성 부착
  mentionManager.attach(elements.commentInput);

  // Slack 알림에 토스트 함수 주입
  slackNotifier.setToastFunction(showToast);

  // 사이드바 댓글 입력 Enter 처리 (역순 플로우: 텍스트 입력 → 마커 찍기)
  async function submitSidebarCommentDraft() {
    const text = elements.commentInput.value.trim();
    if (!text && !state.pendingCommentImage) return false;
    if (!(await ensureCutlistCommentTargetReady())) return false;

    // 텍스트/이미지를 pending으로 설정하고 댓글 모드 활성화
    commentManager.setPendingText(text || '(이미지)');
    // 이미지가 있으면 commentManager에 임시 저장
    if (state.pendingCommentImage) {
      commentManager._pendingImage = state.pendingCommentImage;
    }
    elements.commentInput.value = '';
    clearCommentImage();
    showToast('영상에서 마커를 찍어주세요', 'info');
    return true;
  }

  elements.commentInput.addEventListener('keydown', (e) => {
    // 멘션 드롭다운 열려있으면 Enter를 멘션 선택으로 처리 (댓글 제출 방지)
    if (mentionManager.isVisible) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitSidebarCommentDraft();
    }
  });

  // 전송 버튼 클릭 처리 (Enter와 동일한 동작)
  elements.btnSubmitComment?.addEventListener('click', () => {
    void submitSidebarCommentDraft();
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
  // 이미지가 있으면 동기적으로 preventDefault (async await 이후엔 이미 늦음)
  elements.commentInput.addEventListener('paste', async (e) => {
    // 드라이브 경로 자동 따옴표
    if (handleDrivePathPaste(e)) return;

    if (!hasImageInClipboard(e)) return;
    e.preventDefault();

    const imageData = await getImageFromClipboard(e);
    if (imageData) {
      showCommentImagePreview(imageData);
      showToast('이미지가 첨부되었습니다', 'success');
    }
  });

  // 동적 답글 입력의 경로 paste 처리 (이벤트 위임)
  elements.commentsList?.addEventListener('paste', (e) => {
    if (e.target.closest('.comment-reply-input')) {
      handleDrivePathPaste(e);
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
  markerContainer.addEventListener('click', async (e) => {
    if (!state.isCommentMode) return;

    // 마커 요소 클릭은 무시 (마커 자체의 이벤트 처리)
    if (e.target.closest('.comment-marker')) return;

    // 캔버스 영역 내 상대 좌표 계산
    const rect = markerContainer.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (!(await ensureCutlistCommentTargetReady())) return;

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

  function showVideoLoadingOverlay(message, options = {}) {
    const loadingOverlay = document.getElementById('videoLoadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const loadingProgress = document.getElementById('loadingProgressFill');
    if (!loadingOverlay) return false;

    loadingOverlay.classList.add('active');
    if (options.kind) {
      loadingOverlay.dataset.loadingKind = options.kind;
    }
    if (loadingText) {
      loadingText.textContent = message;
    }
    if (loadingProgress && Number.isFinite(Number(options.progress))) {
      const progress = Math.max(0, Math.min(100, Number(options.progress)));
      loadingProgress.style.width = `${progress}%`;
    }
    return true;
  }

  function hideVideoLoadingOverlay(kind = '') {
    const loadingOverlay = document.getElementById('videoLoadingOverlay');
    if (!loadingOverlay) return;
    if (kind && loadingOverlay.dataset.loadingKind && loadingOverlay.dataset.loadingKind !== kind) return;

    loadingOverlay.classList.remove('active');
    delete loadingOverlay.dataset.loadingKind;
  }

  function showDriveVideoLoadingFeedback(filePath, options = {}) {
    const isDriveBacked = isGoogleDrivePath(filePath) || isGoogleDrivePath(options.preparedVideoPath);
    if (!isDriveBacked) return false;
    return showVideoLoadingOverlay('Google Drive에서 영상 불러오는 중...', {
      kind: 'drive',
      progress: 12
    });
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
        await openSelectedPath(result.filePaths[0]);
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
  function getActiveCommentFilter() {
    return document.querySelector('.filter-chip.active')?.dataset.filter || 'all';
  }

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', function() {
      if (this.id === 'authorFilterBtn' || this.id === 'markerToggleBtn') return;
      document.querySelectorAll('.filter-chip').forEach(c => {
        if (c.id !== 'authorFilterBtn' && c.id !== 'markerToggleBtn') c.classList.remove('active');
      });
      this.classList.add('active');
      const filter = this.dataset.filter;
      commentFilterState.status = filter;
      applyCommentFilters();
      log.debug('필터 변경', { filter });
    });
  });

  // ====== 작성자 필터 드롭다운 ======
  function getAuthorFilterSourceItems() {
    if (playlistUIState.mode === 'continuous') {
      return playlistAggregateCommentRanges;
    }
    if (cutlistUIState.active) {
      return cutlistAggregateCommentRanges;
    }
    return commentManager.getAllMarkers();
  }

  function getAuthorFilterAuthorIds() {
    const uniqueAuthors = new Set();
    getAuthorFilterSourceItems().forEach(m => {
      if (m.deleted) return;
      uniqueAuthors.add(m.authorId || m.author || 'unknown');
    });
    return uniqueAuthors;
  }

  function updateAuthorFilterMenu() {
    const menu = document.getElementById('authorFilterMenu');
    if (!menu) return;

    const allMarkers = getAuthorFilterSourceItems();
    const authors = new Map();

    allMarkers.forEach(m => {
      if (m.deleted) return;
      const id = m.authorId || m.author || 'unknown';
      if (!authors.has(id)) {
        authors.set(id, { name: m.author || '알 수 없음', count: 0 });
      }
      authors.get(id).count++;
    });

    const selectedAll = commentFilterState.authors === null;

    let html = '';
    for (const [authorId, info] of authors) {
      const color = getAuthorColor(authorId);
      const isChecked = selectedAll || commentFilterState.authors.includes(authorId);
      html += `
        <div class="filter-dropdown-item" data-author-id="${escapeHtml(authorId)}">
          <div class="filter-dropdown-check ${isChecked ? 'checked' : ''}">${isChecked ? '✓' : ''}</div>
          <div class="filter-dropdown-dot" style="background: ${color.color}"></div>
          <span class="filter-dropdown-name">${escapeHtml(info.name)}</span>
          <span class="filter-dropdown-solo-hint">솔로</span>
          <span class="filter-dropdown-badge">${info.count}</span>
        </div>`;
    }

    html += '<div class="filter-dropdown-divider"></div>';
    html += `
      <div class="filter-dropdown-item" data-author-id="__all__">
        <div class="filter-dropdown-check ${selectedAll ? 'checked' : ''}">${selectedAll ? '✓' : ''}</div>
        <span class="filter-dropdown-name">전체 선택/해제</span>
      </div>`;
    html += '<div class="filter-dropdown-hint">☑ 체크박스 = 토글 &nbsp; 👤 이름 = 솔로</div>';

    menu.innerHTML = html;
  }

  function resetCommentFilters() {
    commentFilterState.status = 'all';
    commentFilterState.authors = null;
    commentFilterState.showMarkers = true;

    // UI 초기화
    document.querySelectorAll('.filter-chip').forEach(c => {
      if (c.id !== 'authorFilterBtn') {
        c.classList.toggle('active', c.dataset.filter === 'all');
      }
    });
    const authorBtn = document.getElementById('authorFilterBtn');
    if (authorBtn) authorBtn.classList.remove('active');
    const markerBtn = document.getElementById('markerToggleBtn');
    if (markerBtn) markerBtn.classList.add('active');
    const menu = document.getElementById('authorFilterMenu');
    if (menu) menu.classList.remove('open');
  }

  function applyCommentFilters() {
    updateCommentList(commentFilterState.status);
    void refreshCommentRangesForCurrentMode();
    renderVideoMarkers();
    updateTimelineMarkers();
  }

  // 작성자 필터 드롭다운 토글
  document.getElementById('authorFilterBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('authorFilterMenu');
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
      menu.classList.remove('open');
      // 위치 리셋
      menu.style.top = '';
      menu.style.bottom = '';
      menu.style.left = '';
      menu.style.right = '';
    } else {
      updateAuthorFilterMenu();
      // 위치 리셋 후 열기
      menu.style.top = '';
      menu.style.bottom = '';
      menu.style.left = '';
      menu.style.right = '';
      menu.classList.add('open');

      // 레이아웃 확정 후 overflow 보정
      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.bottom > window.innerHeight) {
          menu.style.top = 'auto';
          menu.style.bottom = 'calc(100% + 4px)';
        }
        if (rect.right > window.innerWidth) {
          menu.style.left = 'auto';
          menu.style.right = '0';
        }
      });
    }
  });

  // 작성자 드롭다운 — 마우스 벗어나면 닫기
  let _authorDropdownLeaveTimer = null;
  const authorWrapper = document.getElementById('authorFilterWrapper');
  if (authorWrapper) {
    authorWrapper.addEventListener('mouseleave', () => {
      _authorDropdownLeaveTimer = setTimeout(() => {
        const menu = document.getElementById('authorFilterMenu');
        if (menu) menu.classList.remove('open');
      }, 300); // 300ms 딜레이
    });
    authorWrapper.addEventListener('mouseenter', () => {
      if (_authorDropdownLeaveTimer) {
        clearTimeout(_authorDropdownLeaveTimer);
        _authorDropdownLeaveTimer = null;
      }
    });
  }

  // 드롭다운 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('authorFilterWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      const menu = document.getElementById('authorFilterMenu');
      if (menu) menu.classList.remove('open');
    }
  });

  // 피드백 36: 이전 버전 댓글 보기 드롭다운
  function renderPrevVersionCommentsMenu() {
    const menu = document.getElementById('prevVersionCommentsMenu');
    if (!menu) return;
    const versions = getVersionManager().getAllVersions()
      .filter((v) => v?.path && !isSameFilePath(v.path, state.currentFile));
    const activeLabel = previousVersionComments?.label || null;
    menu.innerHTML = [
      `<button class="filter-dropdown-item${activeLabel === null ? ' active' : ''}" data-version-path="">표시 안 함</button>`,
      ...versions.map((v) => {
        const label = v.displayLabel || (v.version ? `v${v.version}` : v.fileName);
        return `<button class="filter-dropdown-item${activeLabel === label ? ' active' : ''}" data-version-path="${escapeHtmlAttribute(v.path)}">${escapeHtml(label)}</button>`;
      })
    ].join('');
    menu.querySelectorAll('[data-version-path]').forEach((btn) => {
      btn.addEventListener('click', () => {
        menu.classList.remove('open');
        const path = btn.dataset.versionPath;
        if (!path) { void togglePreviousVersionComments(null); return; }
        const version = versions.find((v) => v.path === path);
        void togglePreviousVersionComments(version || null);
      });
    });
  }

  document.getElementById('prevVersionCommentsBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('prevVersionCommentsMenu');
    if (!menu) return;
    renderPrevVersionCommentsMenu();
    menu.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('prevVersionCommentsMenu');
    if (menu?.classList.contains('open') && !e.target.closest('#prevVersionCommentsWrapper')) {
      menu.classList.remove('open');
    }
  });

  // 작성자 선택/해제 (체크박스 토글 + 이름 솔로)
  document.getElementById('authorFilterMenu')?.addEventListener('click', (e) => {
    e.stopPropagation(); // 드롭다운 닫힘 방지

    const item = e.target.closest('.filter-dropdown-item');
    if (!item) return;

    const authorId = item.dataset.authorId;
    const clickedName = e.target.closest('.filter-dropdown-name');

    // 전체 선택/해제
    if (authorId === '__all__') {
      commentFilterState.authors = commentFilterState.authors === null ? [] : null;
    }
    // 이름 클릭 → 솔로 모드
    else if (clickedName) {
      const isSolo = (
        commentFilterState.authors !== null &&
        commentFilterState.authors.length === 1 &&
        commentFilterState.authors[0] === authorId
      );
      commentFilterState.authors = isSolo ? null : [authorId];
    }
    // 체크박스 클릭 → 개별 토글
    else {
      if (commentFilterState.authors === null) {
        // 전체 선택 → 이 작성자만 해제
        const uniqueAuthors = getAuthorFilterAuthorIds();
        commentFilterState.authors = [...uniqueAuthors].filter(id => id !== authorId);
      } else {
        const idx = commentFilterState.authors.indexOf(authorId);
        if (idx !== -1) {
          commentFilterState.authors.splice(idx, 1);
        } else {
          commentFilterState.authors.push(authorId);
        }
        // 모든 작성자가 선택되면 null(전체)로 리셋
        const uniqueAuthors = getAuthorFilterAuthorIds();
        if (commentFilterState.authors.length >= uniqueAuthors.size) {
          commentFilterState.authors = null;
        }
      }
    }

    updateAuthorFilterMenu();
    applyCommentFilters();

    const btn = document.getElementById('authorFilterBtn');
    if (btn) {
      btn.classList.toggle('active', commentFilterState.authors !== null);
    }
  });

  // 뷰포트 마커 토글
  document.getElementById('markerToggleBtn')?.addEventListener('click', () => {
    commentFilterState.showMarkers = !commentFilterState.showMarkers;
    const btn = document.getElementById('markerToggleBtn');
    btn.classList.toggle('active', commentFilterState.showMarkers);
    applyCommentFilters();
  });

  // ====== 댓글 검색 ======
  const commentSearchPlaceholderWords = [
    '도윤이',
    '액팅이',
    '배한솔',
    '안류천',
    '윤성원',
    '허혜원',
    '좋네요',
    '수정',
    '확인'
  ];
  let commentSearchPlaceholderIndex = 0;
  let commentSearchPlaceholderTimer = null;

  function syncCommentSearchUiState() {
    const hasKeyword = !!elements.commentSearchInput?.value.trim();
    elements.commentSearchInputWrap?.classList.toggle('has-text', hasKeyword);
    elements.commentSearchClear?.classList.toggle('visible', hasKeyword);
    elements.commentSearchToggle?.classList.toggle('search-active', hasKeyword);
  }

  function setCommentSearchOpen(isOpen, options = {}) {
    const shouldFocus = !!options.focus;
    elements.commentSearchBar?.classList.toggle('open', isOpen);
    elements.commentSearchToggle?.classList.toggle('search-open', isOpen);

    if (elements.commentSearchToggle) {
      elements.commentSearchToggle.setAttribute('aria-expanded', String(isOpen));
      elements.commentSearchToggle.setAttribute('aria-label', isOpen ? '댓글 검색 닫기' : '댓글 검색 열기');
      elements.commentSearchToggle.title = isOpen ? '댓글 검색 닫기' : '댓글 검색 열기';
    }

    if (!isOpen) {
      elements.commentSearchInputWrap?.classList.remove('is-focused');
    } else if (shouldFocus) {
      requestAnimationFrame(() => elements.commentSearchInput?.focus());
    }
  }

  function rotateCommentSearchPlaceholderWord() {
    const wordEl = elements.commentSearchPlaceholderWord;
    if (!wordEl || commentSearchPlaceholderWords.length === 0) return;

    wordEl.classList.add('fade');
    window.setTimeout(() => {
      commentSearchPlaceholderIndex = (commentSearchPlaceholderIndex + 1) % commentSearchPlaceholderWords.length;
      wordEl.textContent = commentSearchPlaceholderWords[commentSearchPlaceholderIndex];
      wordEl.classList.remove('fade');
    }, 220);
  }

  function startCommentSearchPlaceholderAnimation() {
    if (!elements.commentSearchPlaceholderWord || commentSearchPlaceholderTimer) return;

    elements.commentSearchPlaceholderWord.textContent = commentSearchPlaceholderWords[0];
    commentSearchPlaceholderTimer = window.setInterval(rotateCommentSearchPlaceholderWord, 1700);
  }

  elements.commentSearchToggle?.addEventListener('click', () => {
    const isOpen = elements.commentSearchBar?.classList.contains('open');
    setCommentSearchOpen(!isOpen, { focus: !isOpen });
  });

  elements.commentSearchInput?.addEventListener('focus', () => {
    elements.commentSearchInputWrap?.classList.add('is-focused');
  });

  elements.commentSearchInput?.addEventListener('blur', () => {
    elements.commentSearchInputWrap?.classList.remove('is-focused');
    syncCommentSearchUiState();
  });

  elements.commentSearchInput?.addEventListener('input', () => {
    const keyword = elements.commentSearchInput.value.trim();
    commentSearchKeyword = keyword;
    syncCommentSearchUiState();

    if (keyword) {
      setCommentSearchOpen(true);
    }

    updateCommentList(getActiveCommentFilter());
  });

  elements.commentSearchInput?.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    if (elements.commentSearchInput.value) {
      elements.commentSearchInput.value = '';
      commentSearchKeyword = '';
      syncCommentSearchUiState();
      updateCommentList(getActiveCommentFilter());
      return;
    }

    if (elements.commentSearchBar?.classList.contains('open')) {
      setCommentSearchOpen(false);
      elements.commentSearchInput.blur();
    }
  });

  elements.commentSearchClear?.addEventListener('click', () => {
    if (!elements.commentSearchInput) return;

    elements.commentSearchInput.value = '';
    commentSearchKeyword = '';
    syncCommentSearchUiState();
    updateCommentList(getActiveCommentFilter());
    elements.commentSearchInput.focus();
  });

  // Search panel closes only by toggle button.

  syncCommentSearchUiState();
  setCommentSearchOpen(!!elements.commentSearchInput?.value.trim());
  startCommentSearchPlaceholderAnimation();

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
    updateCommentList(getActiveCommentFilter());
  });

  // 썸네일 스케일 변경
  thumbnailScaleSlider?.addEventListener('input', () => {
    const scale = parseInt(thumbnailScaleSlider.value);
    thumbnailScaleValue.textContent = `${scale}%`;
    userSettings.setCommentThumbnailScale(scale);
    // CSS 변수로 스케일 적용
    document.documentElement.style.setProperty('--comment-thumbnail-scale', scale / 100);
    updateCommentList(getActiveCommentFilter());
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

  // 플렉서스 패널 토글
  const togglePlexusPanel = document.getElementById('togglePlexusPanel');
  if (togglePlexusPanel) {
    togglePlexusPanel.checked = userSettings.settings.showPlexusPanel !== false;
  }
  togglePlexusPanel?.addEventListener('change', () => {
    userSettings.settings.showPlexusPanel = togglePlexusPanel.checked;
    userSettings._save();
    if (!togglePlexusPanel.checked) {
      _hideCollabPlexusPanel();
    }
  });

  // 다른 사람 협업 커서 표시 토글
  const btnToggleRemoteCursors = document.getElementById('btnToggleRemoteCursors');
  const remoteCursorsToggleLabel = document.getElementById('remoteCursorsToggleLabel');
  function updateRemoteCursorToggleButton() {
    const showRemoteCursors = userSettings.getShowRemoteCursors();
    if (remoteCursorsToggleLabel) {
      remoteCursorsToggleLabel.textContent = showRemoteCursors ? '커서 숨기기' : '커서 보이기';
    }
    if (btnToggleRemoteCursors) {
      btnToggleRemoteCursors.classList.toggle('is-muted', !showRemoteCursors);
      btnToggleRemoteCursors.setAttribute('title', showRemoteCursors ? '다른 사람 커서 숨기기' : '다른 사람 커서 보이기');
      btnToggleRemoteCursors.setAttribute('aria-pressed', String(!showRemoteCursors));
    }
  }
  updateRemoteCursorToggleButton();
  btnToggleRemoteCursors?.addEventListener('click', () => {
    userSettings.setShowRemoteCursors(!userSettings.getShowRemoteCursors());
  });

  const savedBrush = userSettings.getBrushSettings();

  // 그리기 도구 선택
  const opacitySection = document.getElementById('opacitySection');
  const brushSizeSlider = document.getElementById('brushSizeSlider');
  const brushSizeValue = document.getElementById('brushSizeValue');
  const sizePreview = document.getElementById('sizePreview');
  const brushOpacitySlider = document.getElementById('brushOpacitySlider');
  const brushOpacityValue = document.getElementById('brushOpacityValue');
  const eraserModeSection = document.getElementById('eraserModeSection');
  const colorSection = document.getElementById('colorSection');
  const strokeSection = document.getElementById('strokeSection');
  const eraserModeButtons = document.querySelectorAll('.eraser-mode-btn[data-eraser-mode]');
  const brushSizeHud = elements.brushSizeHud;

  // 도구 매핑
  const toolMap = {
    select: DrawingTool.SELECT,
    pen: DrawingTool.PEN,
    brush: DrawingTool.BRUSH,
    eraser: DrawingTool.ERASER,
    line: DrawingTool.LINE,
    arrow: DrawingTool.ARROW,
    rect: DrawingTool.RECT,
    circle: DrawingTool.CIRCLE
  };

  // 색상 선택 (8색 팔레트)
  const colorMap = {
    red: '#ff4757',
    yellow: '#ffd000',
    green: '#26de81',
    blue: '#4a9eff',
    white: '#ffffff',
    black: '#000000',
    mint: '#1abc9c',
    pink: '#ff6b9d'
  };

  // 도구별 설정 저장 (크기, 불투명도)
  const toolSettings = {
    eraser: { size: savedBrush.eraserSize },
    brush: { size: savedBrush.brushSize, opacity: savedBrush.opacity }
  };
  let currentToolType = savedBrush.tool === 'eraser' ? 'eraser' : 'brush';
  let currentToolName = toolMap[savedBrush.tool] ? savedBrush.tool : 'brush';
  let currentColor = savedBrush.color;

  function clampBrushSize(size, fallback = 3) {
    const parsed = parseInt(size);
    return Math.min(50, Math.max(1, Number.isFinite(parsed) ? parsed : fallback));
  }

  function clampBrushOpacity(opacity, fallback = 100) {
    const parsed = parseInt(opacity);
    return Math.min(100, Math.max(10, Number.isFinite(parsed) ? parsed : fallback));
  }

  function clampStrokeWidth(width, fallback = 3) {
    const parsed = parseInt(width);
    return Math.min(10, Math.max(1, Number.isFinite(parsed) ? parsed : fallback));
  }

  function getColorNameByHex(hex) {
    const normalized = String(hex || '').toLowerCase();
    return Object.entries(colorMap).find(([, value]) => value.toLowerCase() === normalized)?.[0] || 'red';
  }

  function getCurrentSizeSettingPatch(size = toolSettings[currentToolType].size) {
    return currentToolType === 'eraser'
      ? { eraserSize: size }
      : { brushSize: size };
  }

  function updateSizePreview() {
    const size = brushSizeSlider.value;
    brushSizeValue.textContent = `${size}px`;
    sizePreview.classList.toggle('eraser-preview', currentToolType === 'eraser');
    sizePreview.style.setProperty('--preview-size', `${Math.min(size, 20)}px`);
    sizePreview.style.setProperty('--preview-color', currentColor);
  }

  function applyBrushSizeValue(size, options = {}) {
    const nextSize = clampBrushSize(size, toolSettings[currentToolType].size);
    toolSettings[currentToolType].size = nextSize;
    brushSizeSlider.value = String(nextSize);
    drawingManager.setLineWidth(nextSize);
    updateSizePreview();

    if (options.persist) {
      userSettings.setBrushSettings(getCurrentSizeSettingPatch(nextSize));
    }
    return nextSize;
  }

  function applyBrushOpacityValue(opacity, options = {}) {
    const nextOpacity = clampBrushOpacity(opacity, toolSettings.brush.opacity);
    toolSettings.brush.opacity = nextOpacity;
    brushOpacitySlider.value = String(nextOpacity);
    brushOpacityValue.textContent = `${nextOpacity}%`;
    if (currentToolType !== 'eraser') {
      drawingManager.setOpacity(nextOpacity / 100);
    }
    if (options.persist) {
      userSettings.setBrushSettings({ opacity: nextOpacity });
    }
    return nextOpacity;
  }

  function setActiveColorButton(color) {
    const activeColor = getColorNameByHex(color);
    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === activeColor);
    });
  }

  function setCurrentColor(color, options = {}) {
    currentColor = color || '#ff4757';
    setActiveColorButton(currentColor);
    drawingManager.setColor(currentColor);
    updateSizePreview();
    if (options.persist) {
      userSettings.setBrushSettings({ color: currentColor });
    }
  }

  function updateBrushSizeHud(detail = {}) {
    if (!brushSizeHud) return;
    const size = clampBrushSize(detail.size, toolSettings[currentToolType].size);
    const rect = elements.drawingCanvas?.getBoundingClientRect();
    const scale = rect && elements.drawingCanvas?.width
      ? rect.width / elements.drawingCanvas.width
      : 1;
    const displaySize = Math.max(2, Math.round(size * scale));
    const x = Number.isFinite(detail.clientX) ? detail.clientX : window.innerWidth / 2;
    const y = Number.isFinite(detail.clientY) ? detail.clientY : window.innerHeight / 2;

    brushSizeHud.style.left = `${x}px`;
    brushSizeHud.style.top = `${y}px`;
    brushSizeHud.style.width = `${displaySize}px`;
    brushSizeHud.style.height = `${displaySize}px`;
    brushSizeHud.style.background = currentToolType === 'eraser' ? 'transparent' : `${currentColor}80`;
    brushSizeHud.style.borderColor = currentToolType === 'eraser' ? 'rgba(255, 255, 255, 0.95)' : currentColor;
    brushSizeHud.dataset.sizeLabel = `${size}px`;
    brushSizeHud.textContent = '';
  }

  function showBrushSizeHud(detail = {}) {
    if (!brushSizeHud) return;
    brushSizeHud.hidden = false;
    updateBrushSizeHud(detail);
  }

  function hideBrushSizeHud() {
    if (!brushSizeHud) return;
    brushSizeHud.hidden = true;
  }

  function applyEraserMode(mode, persist = false) {
    mode = normalizeEraserMode(mode);
    eraserModeButtons.forEach(btn => {
      const active = btn.dataset.eraserMode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    drawingManager.setEraserMode(mode);
    if (persist) {
      userSettings.setEraserMode(mode);
    }
    return mode;
  }

  let currentEraserMode = applyEraserMode(userSettings.getEraserMode() || ERASER_MODES.PIXEL);

  eraserModeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = normalizeEraserMode(btn.dataset.eraserMode);
      currentEraserMode = applyEraserMode(mode, true);
    });
  });

  function selectDrawingTool(toolName, options = {}) {
    const persist = options.persist !== false;
    drawingManager.commitActiveSelection();
    toolName = toolMap[toolName] ? toolName : 'brush';
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });

    if (persist) {
      toolSettings[currentToolType].size = clampBrushSize(brushSizeSlider.value, toolSettings[currentToolType].size);
      if (currentToolType === 'brush') {
        toolSettings.brush.opacity = clampBrushOpacity(brushOpacitySlider.value, toolSettings.brush.opacity);
      }
    }

    currentToolName = toolName;
    currentToolType = toolName === 'eraser' ? 'eraser' : 'brush';
    applyBrushSizeValue(toolSettings[currentToolType].size);

    if (currentToolType === 'eraser') {
      opacitySection.style.display = 'none';
      if (colorSection) colorSection.style.display = 'none';
      if (strokeSection) strokeSection.style.display = 'none';
      if (eraserModeSection) eraserModeSection.hidden = false;
      applyEraserMode(currentEraserMode);
      drawingManager.setOpacity(1);
    } else {
      opacitySection.style.display = 'block';
      if (colorSection) colorSection.style.display = 'block';
      if (strokeSection) strokeSection.style.display = 'block';
      if (eraserModeSection) eraserModeSection.hidden = true;
      applyBrushOpacityValue(toolSettings.brush.opacity);
    }

    drawingManager.setTool(toolMap[toolName]);

    if (persist) {
      userSettings.setBrushSettings({ tool: toolName, brushSize: toolSettings.brush.size, eraserSize: toolSettings.eraser.size });
    }
    log.debug('도구 선택', { tool: toolName, size: toolSettings[currentToolType].size });
  }

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', function() {
      selectDrawingTool(this.dataset.tool);
    });
  });

  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      setCurrentColor(colorMap[this.dataset.color] || '#ff4757', { persist: true });
      log.debug('색상 선택', { color: this.dataset.color });
    });
  });

  brushSizeSlider.addEventListener('input', function() {
    applyBrushSizeValue(this.value);
  });

  brushSizeSlider.addEventListener('change', function() {
    applyBrushSizeValue(this.value, { persist: true });
  });

  // 불투명도 슬라이더
  brushOpacitySlider.addEventListener('input', function() {
    applyBrushOpacityValue(this.value);
  });

  brushOpacitySlider.addEventListener('change', function() {
    applyBrushOpacityValue(this.value, { persist: true });
  });

  function adjustBrushSizeBy(delta, options = {}) {
    const nextSize = toolSettings[currentToolType].size + delta;
    return applyBrushSizeValue(nextSize, options);
  }

  // ====== 브러시 외곽선 ======
  const strokeToggle = document.getElementById('strokeToggle');
  const strokeControls = document.getElementById('strokeControls');
  const strokeWidthSlider = document.getElementById('strokeWidthSlider');
  const strokeWidthValue = document.getElementById('strokeWidthValue');
  let currentStrokeColor = savedBrush.strokeColor;

  function setActiveStrokeColorButton(color) {
    document.querySelectorAll('.stroke-color-btn[data-stroke-color]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.strokeColor === color);
    });
  }

  function applyStrokeSettings(settings = {}, options = {}) {
    const strokeEnabled = settings.strokeEnabled === true;
    const strokeWidth = clampStrokeWidth(settings.strokeWidth, 3);
    const strokeColor = settings.strokeColor || '#ffffff';

    strokeToggle?.classList.toggle('active', strokeEnabled);
    if (strokeToggle) strokeToggle.textContent = strokeEnabled ? 'ON' : 'OFF';
    strokeControls?.classList.toggle('visible', strokeEnabled);
    if (strokeWidthSlider) strokeWidthSlider.value = String(strokeWidth);
    if (strokeWidthValue) strokeWidthValue.textContent = `${strokeWidth}px`;
    currentStrokeColor = strokeColor;
    setActiveStrokeColorButton(currentStrokeColor);

    drawingManager.setStrokeEnabled(strokeEnabled);
    drawingManager.setStrokeWidth(strokeWidth);
    drawingManager.setStrokeColor(currentStrokeColor);

    if (options.persist) {
      userSettings.setBrushSettings({
        strokeEnabled,
        strokeWidth,
        strokeColor: currentStrokeColor
      });
    }
  }

  // 외곽선 토글
  strokeToggle?.addEventListener('click', () => {
    const isActive = !strokeToggle.classList.contains('active');
    applyStrokeSettings({
      strokeEnabled: isActive,
      strokeWidth: strokeWidthSlider?.value,
      strokeColor: currentStrokeColor
    }, { persist: true });
  });

  // 외곽선 두께
  strokeWidthSlider?.addEventListener('input', function() {
    const width = clampStrokeWidth(this.value);
    strokeWidthValue.textContent = `${width}px`;
    drawingManager.setStrokeWidth(width);
  });
  strokeWidthSlider?.addEventListener('change', function() {
    userSettings.setBrushSettings({ strokeWidth: clampStrokeWidth(this.value) });
  });

  // 외곽선 색상
  document.querySelectorAll('.stroke-color-btn[data-stroke-color]').forEach(btn => {
    btn.addEventListener('click', function() {
      const color = this.dataset.strokeColor;
      currentStrokeColor = color;
      setActiveStrokeColorButton(color);
      drawingManager.setStrokeColor(color);
      userSettings.setBrushSettings({ strokeColor: color });
    });
  });

  drawingManager.drawingCanvas?.addEventListener('sizeadjuststart', (event) => {
    showBrushSizeHud(event.detail);
  });
  drawingManager.drawingCanvas?.addEventListener('sizeadjust', (event) => {
    const size = applyBrushSizeValue(event.detail.size);
    updateBrushSizeHud({ ...event.detail, size });
  });
  drawingManager.drawingCanvas?.addEventListener('sizeadjustend', (event) => {
    const size = applyBrushSizeValue(event.detail.size, { persist: true });
    updateBrushSizeHud({ ...event.detail, size });
    hideBrushSizeHud();
  });

  function applySavedBrushSettings(settings = userSettings.getBrushSettings()) {
    toolSettings.eraser.size = clampBrushSize(settings.eraserSize, 20);
    toolSettings.brush.size = clampBrushSize(settings.brushSize, 3);
    toolSettings.brush.opacity = clampBrushOpacity(settings.opacity, 100);
    currentStrokeColor = settings.strokeColor || '#ffffff';

    setCurrentColor(settings.color, { persist: false });
    applyBrushOpacityValue(toolSettings.brush.opacity);
    applyStrokeSettings(settings);
    selectDrawingTool(settings.tool, { persist: false });
  }

  applySavedBrushSettings(savedBrush);

  // Undo 버튼
  elements.btnUndo?.addEventListener('click', async () => {
    if (await globalUndo()) {
      showToast('실행 취소됨', 'info');
    }
  });

  // 전체 지우기 버튼
  elements.btnClearDrawing?.addEventListener('click', () => {
    const layer = drawingManager.getActiveLayer();
    if (layer) {
      if (layer.locked || layer.visible === false) {
        const message = layer.visible === false
          ? '숨긴 레이어는 지울 수 없습니다. 레이어를 보이게 켠 뒤 다시 시도하세요.'
          : '잠긴 레이어는 지울 수 없습니다. 잠금을 해제한 뒤 다시 시도하세요.';
        showToast(message, 'warning');
        return;
      }

      // 현재 키프레임의 데이터를 지움
      const keyframe = layer.getKeyframeAtFrame(drawingManager.currentFrame);
      const hasClearableSelection = !!(
        drawingManager.drawingCanvas?.floatingImage ||
        drawingManager.drawingCanvas?.selection
      );
      if ((keyframe && !keyframe.isEmpty) || hasClearableSelection) {
        drawingManager._saveToHistory();
        drawingManager.drawingCanvas?.clearSelection?.();
        if (keyframe && !keyframe.isEmpty) {
          keyframe.setCanvasData(null);
          keyframe.baseCanvasData = null;
          keyframe.strokeRecords = [];
        }
        drawingManager.renderFrame(drawingManager.currentFrame);
        showToast('현재 프레임 지워짐', 'info');
      }
    }
  });

  function renderDrawingLayerTimeline() {
    timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
  }

  function addDrawingLayer() {
    const activeIndex = drawingManager.layers.findIndex(l => l.id === drawingManager.activeLayerId);
    // 피드백 23: 사용자 기준(패널 시각)으로 활성 레이어 "바로 위 행"에 추가한다.
    // 패널은 배열 인덱스 0이 최상단이므로 activeIndex 위치에 삽입한다.
    // (합성 기준으로는 활성 레이어 뒤가 되는 트레이드오프 — 패널 기준을 우선한다.)
    const insertIndex = activeIndex === -1 ? drawingManager.layers.length : activeIndex;
    const insertBeforeLayerId = activeIndex === -1 ? null : drawingManager.activeLayerId;
    drawingManager.createLayer({ insertIndex, insertBeforeLayerId });
    renderDrawingLayerTimeline();
    showToast('새 레이어 추가됨', 'success');
  }

  function deleteDrawingLayer(layerId) {
    if (!layerId) {
      showToast('삭제할 레이어가 없습니다.', 'warn');
      return;
    }
    if (drawingManager.layers.length <= 1) {
      showToast('마지막 레이어는 삭제할 수 없습니다.', 'warn');
      return;
    }
    if (drawingManager.deleteLayer(layerId)) {
      hideLayerSettingsPopup();
      renderDrawingLayerTimeline();
      showToast('레이어 삭제됨', 'info');
    }
  }

  function deleteActiveDrawingLayer() {
    deleteDrawingLayer(drawingManager.activeLayerId);
  }

  function selectDrawingLayerByOffset(offset) {
    if (drawingManager.selectActiveLayerByOffset(offset)) {
      renderDrawingLayerTimeline();
    }
  }

  function moveDrawingLayerByOffset(offset) {
    if (drawingManager.moveActiveLayerByOffset(offset)) {
      renderDrawingLayerTimeline();
      showToast('레이어 순서가 변경되었습니다.', 'info');
    }
  }

  // 레이어 추가 버튼
  elements.btnAddLayer?.addEventListener('click', addDrawingLayer);

  // 레이어 삭제 버튼
  elements.btnDeleteLayer?.addEventListener('click', deleteActiveDrawingLayer);

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
  const loopControlsEl = document.getElementById('loopControls');
  const btnLoopControlsToggle = document.getElementById('btnLoopControlsToggle');
  const btnSetInPoint = document.getElementById('btnSetInPoint');
  const btnSetOutPoint = document.getElementById('btnSetOutPoint');
  const btnLoopToggle = document.getElementById('btnLoopToggle');
  const btnClearLoop = document.getElementById('btnClearLoop');
  const inPointDisplay = document.getElementById('inPointDisplay');
  const outPointDisplay = document.getElementById('outPointDisplay');

  // 구간 반복 컨트롤 접기/열기 토글
  btnLoopControlsToggle?.addEventListener('click', () => {
    loopControlsEl?.classList.toggle('expanded');
  });

  // 시작점 설정
  btnSetInPoint.addEventListener('click', () => {
    const time = videoPlayer.setInPointAtCurrent();
    inPointDisplay.textContent = videoPlayer.formatTimeShort(time);
    btnSetInPoint.classList.add('has-point');
    loopControlsEl?.classList.add('expanded');
    showToast(`시작점 설정: ${videoPlayer.formatTimeShort(time)}`, 'info');
  });

  // 종료점 설정
  btnSetOutPoint.addEventListener('click', () => {
    const time = videoPlayer.setOutPointAtCurrent();
    outPointDisplay.textContent = videoPlayer.formatTimeShort(time);
    btnSetOutPoint.classList.add('has-point');
    loopControlsEl?.classList.add('expanded');
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
    loopControlsEl?.classList.remove('expanded');
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
    // Alt 조합(Ctrl+Alt+C/V 프레임 복붙)은 하이라이트 복붙이 아님
    if (e.altKey) return;

    // Ctrl+C: 선택된 하이라이트 복사
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      // 하이라이트 팝업이 열려있고 선택된 하이라이트가 있으면 복사
      if (highlightPopup.style.display === 'block' && selectedHighlightId) {
        e.preventDefault();
        highlightManager.copyHighlight(selectedHighlightId);
        showToast('하이라이트가 복사되었습니다', 'info');
      }
    }

    // Ctrl+V: 하이라이트 붙여넣기 (클립보드에 이미지가 있으면 캡처 붙여넣기에 양보)
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (highlightManager.hasClipboard() && videoPlayer.duration) {
        void (async () => {
          if (await window.electronAPI.clipboardHasImage()) return;
          const currentTime = videoPlayer.currentTime || 0;
          const highlight = highlightManager.pasteHighlight(currentTime);
          if (highlight) {
            renderHighlights();
            showToast('하이라이트가 붙여넣기 되었습니다', 'info');
          }
        })();
      }
    }
  });

  // ====== 마커 색상 팝업 ======
  // (마커 색상 팝업 비활성화 - 작성자 자동 색상으로 전환)

  // ====== 댓글 범위 트랙 ======
  const commentTrack = document.getElementById('commentTrack');
  const commentLayerHeader = document.getElementById('commentLayerHeader');

  // 댓글 트랙 연결
  timeline.setCommentTrack(commentTrack, commentLayerHeader);

  // 현재 선택된 댓글 범위
  let selectedCommentRange = null; // { layerId, markerId }

  // 댓글 드래그 상태
  let commentDragState = null;
  let commentJustDragged = false; // 드래그 직후 click 차단용 1-tick 플래그
  let commentInteractionsBound = false; // 위임 리스너 1회 바인딩 가드
  let ctrlCommentResizeKeyDown = false;
  let ctrlCommentResizeCandidate = null;
  const CTRL_COMMENT_RESIZE_MIN_HIT_WIDTH = 72;
  const CTRL_COMMENT_RESIZE_VERTICAL_PAD = 10;

  // 클러스터 호버 툴팁 상태
  let clusterTooltipEl = null;
  let clusterTooltipTimer = null;

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
        scheduleMpvOverlayStateSync();
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
        scheduleMpvOverlayStateSync();
      }
    });
  }

  // 비디오 오버레이에 댓글 범위 렌더링
  function renderVideoCommentRanges() {
    if (!videoCommentRangeOverlay) return;

    let ranges = commentManager.getMarkerRanges();

    // 작성자 필터 적용
    if (commentFilterState.authors !== null) {
      const allowedIds = new Set(
        filterByAuthors(commentManager.getAllMarkers()).map(m => m.id)
      );
      ranges = ranges.filter(r => allowedIds.has(r.markerId));
    }

    // 기존 요소 제거
    videoCommentRangeOverlay.innerHTML = '';

    // 댓글이 없으면 숨김
    if (!ranges || ranges.length === 0) {
      videoCommentRangeOverlay.classList.remove('visible');
      scheduleMpvOverlayStateSync();
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

      // 색상 (작성자 색상 기반)
      const rangeMarker = commentManager.getMarker(comment.markerId);
      const authorColorInfo = rangeMarker
        ? getAuthorColor(rangeMarker.authorId || rangeMarker.author || 'unknown')
        : { color: comment.color || '#4a9eff' };
      const color = authorColorInfo.color;
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

      videoCommentRangeOverlay.appendChild(bar);
    });

    // 초기 플레이헤드 위치 업데이트
    updateVideoCommentPlayhead();
    scheduleMpvOverlayStateSync();
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
    scheduleMpvOverlayStateSync();
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
    let ranges = cutlistUIState.active
      ? cutlistAggregateCommentRanges
      : commentManager.getMarkerRanges();

    // 작성자 필터 적용
    if (!cutlistUIState.active && commentFilterState.authors !== null) {
      const allowedIds = new Set(
        filterByAuthors(commentManager.getAllMarkers()).map(m => m.id)
      );
      ranges = ranges.filter(r => allowedIds.has(r.markerId));
    }

    if (cutlistUIState.active) {
      ranges = filterCutlistAggregateCommentRanges(ranges, commentFilterState.status);
    }

    timeline.renderCommentRanges(ranges);
    setupCommentRangeInteractions();
    renderVideoCommentRanges();
  }

  async function refreshCommentRangesForCurrentMode(options = {}) {
    const { skipContinuousTimelineRefresh = false } = options;
    if (playlistUIState.mode === 'continuous') {
      setupCommentRangeInteractions();
      renderVideoCommentRanges();
      if (skipContinuousTimelineRefresh && timeline.playlistDuration > 0) {
        renderPlaylistContinuousCommentList(commentFilterState.status);
        return;
      }
      await updatePlaylistContinuousTimeline();
      return;
    }

    if (cutlistUIState.active) {
      setupCommentRangeInteractions();
      renderVideoCommentRanges();
      await updateCutlistAggregateComments();
      return;
    }

    renderCommentRanges();
  }

  function getEditableClusterMembers(clusterBadge) {
    const key = clusterBadge?.dataset.clusterKey;
    if (!key) return [];
    return key.split('|')
      .map(markerId => commentManager.getMarker(markerId))
      .filter(Boolean);
  }

  function getResizeEdgeFromRectHalf(rect, clientX) {
    return clientX <= rect.left + rect.width / 2 ? 'left' : 'right';
  }

  function getResizeEdgeFromElementHalf(element, e) {
    return getResizeEdgeFromRectHalf(element.getBoundingClientRect(), e.clientX);
  }

  function getCtrlCommentResizeHitRect(rect) {
    const extraX = Math.max(0, (CTRL_COMMENT_RESIZE_MIN_HIT_WIDTH - rect.width) / 2);
    return {
      left: rect.left - extraX,
      right: rect.right + extraX,
      top: rect.top - CTRL_COMMENT_RESIZE_VERTICAL_PAD,
      bottom: rect.bottom + CTRL_COMMENT_RESIZE_VERTICAL_PAD
    };
  }

  function isPointInClientRect(rect, clientX, clientY) {
    return clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
  }

  function findCtrlCommentResizeTarget(e) {
    if (!commentTrack) return null;
    const candidates = Array.from(
      commentTrack.querySelectorAll('.comment-range-item, .comment-cluster-badge')
    );
    let best = null;

    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      const hitRect = getCtrlCommentResizeHitRect(rect);
      if (!isPointInClientRect(hitRect, e.clientX, e.clientY)) continue;

      const centerY = rect.top + rect.height / 2;
      const overflowX = Math.max(rect.left - e.clientX, e.clientX - rect.right, 0);
      const score = Math.abs(e.clientY - centerY) * 2 + overflowX;
      if (!best || score < best.score) {
        best = {
          element,
          edge: getResizeEdgeFromRectHalf(rect, e.clientX),
          score
        };
      }
    }

    return best;
  }

  function clearCtrlCommentResizeCandidate() {
    if (ctrlCommentResizeCandidate?.element) {
      ctrlCommentResizeCandidate.element.classList.remove(
        'ctrl-resize-candidate',
        'ctrl-resize-left',
        'ctrl-resize-right'
      );
    }
    ctrlCommentResizeCandidate = null;
    commentTrack?.classList.remove('ctrl-resize-active');
  }

  function setCtrlCommentResizeCandidate(target) {
    if (
      ctrlCommentResizeCandidate?.element === target?.element &&
      ctrlCommentResizeCandidate?.edge === target?.edge
    ) {
      return;
    }

    clearCtrlCommentResizeCandidate();
    if (!target?.element) return;

    target.element.classList.add('ctrl-resize-candidate', `ctrl-resize-${target.edge}`);
    ctrlCommentResizeCandidate = target;
    commentTrack?.classList.add('ctrl-resize-active');
  }

  function updateCtrlCommentResizeCandidate(e) {
    if (commentDragState || (!e.ctrlKey && !ctrlCommentResizeKeyDown)) {
      clearCtrlCommentResizeCandidate();
      return;
    }

    const target = findCtrlCommentResizeTarget(e);
    setCtrlCommentResizeCandidate(target);
  }

  function getClusterResizeEdgeFromEvent(clusterBadge, e) {
    const clusterHandle = e.target.closest('.comment-cluster-handle');
    if (clusterHandle?.dataset.handle) {
      return clusterHandle.dataset.handle;
    }

    return getResizeEdgeFromElementHalf(clusterBadge, e);
  }

  function beginCommentRangeResize(item, marker, handle, e) {
    const markerId = item.dataset.markerId;
    const layerId = item.dataset.layerId;
    e.preventDefault();
    e.stopPropagation();
    clearCtrlCommentResizeCandidate();
    commentDragState = {
      layerId,
      markerId,
      handle,
      startX: e.clientX,
      startFrame: marker.startFrame,
      endFrame: marker.endFrame,
      duration: marker.endFrame - marker.startFrame,
      originalStartFrame: marker.startFrame,
      originalEndFrame: marker.endFrame
    };
    item.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
  }

  function beginCommentRangeMove(item, marker, e) {
    const markerId = item.dataset.markerId;
    const layerId = item.dataset.layerId;
    e.preventDefault();
    commentDragState = {
      layerId,
      markerId,
      handle: 'move',
      startX: e.clientX,
      startFrame: marker.startFrame,
      endFrame: marker.endFrame,
      duration: marker.endFrame - marker.startFrame,
      originalStartFrame: marker.startFrame,
      originalEndFrame: marker.endFrame
    };
    item.classList.add('dragging');
    document.body.style.cursor = 'grabbing';
  }

  function beginCommentClusterResize(clusterBadge, edge, e) {
    const members = getEditableClusterMembers(clusterBadge);
    if (members.length === 0) return false;

    if (!members.every(marker => commentManager.canEdit(marker))) {
      showToast('본인 코멘트만 수정할 수 있습니다.', 'warning');
      return false;
    }

    e.preventDefault();
    e.stopPropagation();
    hideClusterTooltip();
    cancelClusterTooltip();
    clearCtrlCommentResizeCandidate();

    commentDragState = {
      type: 'cluster',
      clusterKey: clusterBadge.dataset.clusterKey,
      handle: edge,
      startX: e.clientX,
      members: members.map(marker => ({
        layerId: marker.layerId,
        markerId: marker.id,
        startFrame: marker.startFrame,
        endFrame: marker.endFrame
      })),
      originalMembers: members.map(marker => ({
        layerId: marker.layerId,
        markerId: marker.id,
        startFrame: marker.startFrame,
        endFrame: marker.endFrame
      }))
    };

    clusterBadge.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    return true;
  }

  function applyCommentClusterResize(e) {
    const { handle, startX, members } = commentDragState;
    const trackRect = commentTrack.getBoundingClientRect();
    const totalFrames = timeline.totalFrames || 1;
    const deltaX = e.clientX - startX;
    const deltaFrames = Math.round((deltaX / trackRect.width) * totalFrames);
    const { updates } = resizeClusterMembersByEdge(members, {
      edge: handle,
      deltaFrames,
      totalFrames
    });

    for (const update of updates) {
      commentManager.updateMarker(update.markerId, {
        startFrame: update.startFrame,
        endFrame: update.endFrame
      });
    }
    renderCommentRanges();
  }

  function finishCommentClusterResize(dragState) {
    const nextMembers = dragState.originalMembers.map(original => {
      const marker = commentManager.getMarker(original.markerId);
      return {
        ...original,
        startFrame: marker?.startFrame ?? original.startFrame,
        endFrame: marker?.endFrame ?? original.endFrame
      };
    });

    const changed = nextMembers.some((next, index) =>
      next.startFrame !== dragState.originalMembers[index].startFrame ||
      next.endFrame !== dragState.originalMembers[index].endFrame
    );

    if (!changed) return;

    pushUndo({
      type: 'comment-cluster-range',
      data: { clusterKey: dragState.clusterKey },
      undo: () => {
        for (const original of dragState.originalMembers) {
          commentManager.updateMarker(original.markerId, {
            startFrame: original.startFrame,
            endFrame: original.endFrame
          });
        }
        renderCommentRanges();
        reviewDataManager.save();
      },
      redo: () => {
        for (const next of nextMembers) {
          commentManager.updateMarker(next.markerId, {
            startFrame: next.startFrame,
            endFrame: next.endFrame
          });
        }
        renderCommentRanges();
        reviewDataManager.save();
      }
    });
  }

  // 댓글 범위 상호작용 설정 — commentTrack 1곳에 이벤트 위임 (1회만 바인딩)
  // 위임으로 전환한 이유: PR #112 이후 클러스터 펼침 시 .comment-range-item이 재생성되는데
  // 요소별 바인딩 방식은 재렌더 후 이벤트가 비어 편집 regression이 발생했다.
  function setupCommentRangeInteractions() {
    if (commentInteractionsBound) return;
    if (!commentTrack) return;
    commentInteractionsBound = true;

    // 클릭 — 해당 댓글 선택 + 프레임 이동 + 댓글 하이라이트
    // 트랙 배경 클릭은 펼친 클러스터 접기
    commentTrack.addEventListener('click', async (e) => {
      if (commentDragState || commentJustDragged) return;

      // 핸들/배지/접기 배지 클릭은 mousedown에서 처리하므로 무시
      if (e.target.closest('.comment-handle')) return;
      if (e.target.closest('.comment-cluster-badge')) return;
      if (e.target.closest('.comment-cluster-close-badge')) return;

      const playlistCommentItem = e.target.closest('.playlist-comment-range');
      if (playlistCommentItem) {
        await openPlaylistAggregateComment(playlistCommentItem.dataset.aggregateCommentKey);
        return;
      }

      const item = e.target.closest('.comment-range-item');
      if (item) {
        if (item.dataset.cutlistAggregateCommentKey) {
          await openCutlistAggregateComment(item.dataset.cutlistAggregateCommentKey);
          return;
        }

        const layerId = item.dataset.layerId;
        const markerId = item.dataset.markerId;
        const marker = commentManager.getMarker(markerId);
        if (marker) {
          videoPlayer.seekToFrame(marker.startFrame);
          videoPlayer.pause();
          scrollToCommentWithGlow(markerId);
        }
        commentTrack.querySelectorAll('.comment-range-item').forEach(i =>
          i.classList.remove('selected')
        );
        item.classList.add('selected');
        selectedCommentRange = { layerId, markerId };
        return;
      }

      // 트랙 배경 클릭 → 펼친 클러스터 접기
      if (e.target === commentTrack && timeline.expandedClusterId !== null) {
        timeline.expandedClusterId = null;
        timeline.renderCommentRanges(timeline._lastComments || []);
      }
    });

    // mousedown — 드래그/리사이즈/펼치기/접기 라우팅
    commentTrack.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      // 1) 접기 배지 → 클러스터 접기
      if (e.target.closest('.comment-cluster-close-badge')) {
        e.preventDefault();
        e.stopPropagation();
        timeline.expandedClusterId = null;
        timeline.renderCommentRanges(timeline._lastComments || []);
        return;
      }

      // 2) 클러스터 배지 → Ctrl/핸들은 그룹 리사이즈, 일반 클릭은 펼치기 토글
      const clusterHandle = e.target.closest('.comment-cluster-handle');
      const clusterBadge = e.target.closest('.comment-cluster-badge');
      if (clusterBadge) {
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey || clusterHandle) {
          const edge = getClusterResizeEdgeFromEvent(clusterBadge, e);
          beginCommentClusterResize(clusterBadge, edge, e);
          return;
        }
        const key = clusterBadge.dataset.clusterKey;
        timeline.expandedClusterId = (timeline.expandedClusterId === key) ? null : key;
        timeline.renderCommentRanges(timeline._lastComments || []);
        return;
      }

      if (e.ctrlKey) {
        const ctrlTarget = findCtrlCommentResizeTarget(e);
        if (ctrlTarget) {
          if (ctrlTarget.element.classList.contains('comment-cluster-badge')) {
            beginCommentClusterResize(ctrlTarget.element, ctrlTarget.edge, e);
            return;
          }

          const marker = commentManager.getMarker(ctrlTarget.element.dataset.markerId);
          if (!marker) return;
          if (!commentManager.canEdit(marker)) {
            showToast('본인 코멘트만 수정할 수 있습니다.', 'warning');
            return;
          }
          beginCommentRangeResize(ctrlTarget.element, marker, ctrlTarget.edge, e);
          return;
        }
      }

      // 3) 핸들 mousedown → 리사이즈 시작
      const handle = e.target.closest('.comment-handle');
      if (handle) {
        const item = handle.closest('.comment-range-item');
        if (!item) return;
        const markerId = item.dataset.markerId;
        const marker = commentManager.getMarker(markerId);
        if (!marker) return;
        if (!commentManager.canEdit(marker)) {
          showToast('본인 코멘트만 수정할 수 있습니다.', 'warning');
          return;
        }
        beginCommentRangeResize(item, marker, handle.dataset.handle, e);
        return;
      }

      // 4) 코멘트 바 본체 mousedown → 이동 드래그 시작
      const item = e.target.closest('.comment-range-item');
      if (item) {
        const markerId = item.dataset.markerId;
        const marker = commentManager.getMarker(markerId);
        if (!marker) return;
        if (!commentManager.canEdit(marker)) {
          showToast('본인 코멘트만 수정할 수 있습니다.', 'warning');
          return;
        }
        e.preventDefault();

        if (e.ctrlKey) {
          beginCommentRangeResize(item, marker, getResizeEdgeFromElementHalf(item, e), e);
          return;
        }

        beginCommentRangeMove(item, marker, e);
      }
    });

    // mouseover / mouseout — 접힌 클러스터 배지 호버 팝업
    commentTrack.addEventListener('mouseover', (e) => {
      const badge = e.target.closest('.comment-cluster-badge');
      if (!badge) return;
      if (timeline.expandedClusterId !== null) return; // 펼친 상태면 팝업 안 띄움
      if (commentDragState) return;

      cancelClusterTooltip();
      clusterTooltipTimer = setTimeout(() => {
        showClusterTooltip(badge);
      }, 300);
    });

    commentTrack.addEventListener('mouseout', (e) => {
      const badge = e.target.closest('.comment-cluster-badge');
      if (!badge) return;
      cancelClusterTooltip();
      hideClusterTooltip();
    });

    commentTrack.addEventListener('mousemove', updateCtrlCommentResizeCandidate);
    commentTrack.addEventListener('mouseleave', clearCtrlCommentResizeCandidate);
  }

  function cancelClusterTooltip() {
    if (clusterTooltipTimer) {
      clearTimeout(clusterTooltipTimer);
      clusterTooltipTimer = null;
    }
  }

  function hideClusterTooltip() {
    if (clusterTooltipEl) clusterTooltipEl.classList.remove('visible');
  }

  function ensureClusterTooltip() {
    if (clusterTooltipEl) return clusterTooltipEl;
    const el = document.createElement('div');
    // 기존 단일 마커 툴팁과 동일한 시각 스타일 재사용
    el.className = 'comment-marker-tooltip cluster-hover';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    clusterTooltipEl = el;
    return el;
  }

  function escapeTooltipText(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }

  function showClusterTooltip(badge) {
    const key = badge.dataset.clusterKey;
    if (!key) return;
    const members = key.split('|').map(id => commentManager.getMarker(id)).filter(Boolean);
    if (members.length === 0) return;

    const tooltip = ensureClusterTooltip();

    // 대표 시작 프레임과 타임코드 (최소 startFrame 기준)
    const minStart = Math.min(...members.map(m => m.startFrame));
    const repMember = members.find(m => m.startFrame === minStart) || members[0];
    const startTimecode = repMember.startTimecode || '';

    // 각 댓글 박스 (기존 .tooltip-comment 스타일: 왼쪽 accent border)
    const commentsHtml = members.map(m => {
      const text = m.text || '';
      const hasImage = !!m.image;
      const displayText = text === '(이미지)' ? '' : text;
      const preview = displayText.length > 50
        ? displayText.substring(0, 50) + '...'
        : displayText;
      const imageIcon = hasImage ? '<span class="tooltip-image-icon">🖼</span>' : '';
      const textHtml = preview ? escapeTooltipText(preview) : '';
      const body = textHtml || (hasImage ? '이미지' : '');
      return `<div class="tooltip-comment">${imageIcon}${body}</div>`;
    }).join('');

    const headerHtml = startTimecode
      ? `<div class="tooltip-header"><span class="tooltip-timecode">${escapeTooltipText(startTimecode)}</span><span class="tooltip-frame">${minStart}f</span></div>`
      : `<div class="tooltip-frame">프레임 ${minStart}</div>`;

    tooltip.innerHTML = `
      ${headerHtml}
      <div class="tooltip-comments">${commentsHtml}</div>
      ${members.length > 1 ? `<div class="tooltip-count">${members.length}개 댓글</div>` : ''}
    `;

    // 위치: 배지 위쪽 우선, 상단 근처면 아래로 폴백 (translateY -50% 는 cluster-hover modifier로 무효화됨)
    tooltip.classList.add('visible');
    const badgeRect = badge.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();

    let top = badgeRect.top - tipRect.height - 8;
    if (top < 10) top = badgeRect.bottom + 8;
    let left = badgeRect.left + (badgeRect.width / 2) - (tipRect.width / 2);
    left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Control') return;
    ctrlCommentResizeKeyDown = true;
  });

  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Control') return;
    ctrlCommentResizeKeyDown = false;
    clearCtrlCommentResizeCandidate();
  });

  window.addEventListener('blur', () => {
    ctrlCommentResizeKeyDown = false;
    clearCtrlCommentResizeCandidate();
  });

  // 댓글 드래그 처리 (mousemove)
  document.addEventListener('mousemove', (e) => {
    if (!commentDragState) return;

    if (commentDragState.type === 'cluster') {
      applyCommentClusterResize(e);
      return;
    }

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
      if (commentDragState.type === 'cluster') {
        const draggingCluster = commentTrack.querySelector(
          `.comment-cluster-badge[data-cluster-key="${commentDragState.clusterKey}"]`
        );
        draggingCluster?.classList.remove('dragging');
        finishCommentClusterResize(commentDragState);
        commentDragState = null;
        document.body.style.cursor = '';
        clearCtrlCommentResizeCandidate();
        commentJustDragged = true;
        setTimeout(() => { commentJustDragged = false; }, 50);
        reviewDataManager.save();
        return;
      }

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
      clearCtrlCommentResizeCandidate();

      // 드래그 직후 click 이벤트 차단 (클릭으로 오인한 접힘/선택 방지)
      commentJustDragged = true;
      setTimeout(() => { commentJustDragged = false; }, 50);

      // 데이터 저장
      reviewDataManager.save();
    }
  });

  // 댓글 매니저 이벤트 수신 - 마커 변경 시 렌더링
  commentManager.addEventListener('markerAdded', () => {
    void refreshCommentRangesForCurrentMode();
  });

  commentManager.addEventListener('markerUpdated', () => {
    if (suppressCommentRangeRefreshOnce) {
      suppressCommentRangeRefreshOnce = false;
      return;
    }
    void refreshCommentRangesForCurrentMode();
  });

  commentManager.addEventListener('markerDeleted', () => {
    void refreshCommentRangesForCurrentMode();
  });

  commentManager.addEventListener('loaded', () => {
    void refreshCommentRangesForCurrentMode();
    updateCommentList();
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

  function shouldCenterVideo() {
    return state.videoCenterLocked && state.videoZoom <= 100;
  }

  function canPanVideo() {
    const zoomAllowsPan = state.videoZoom > 100 || !state.videoCenterLocked;
    if (state.isDrawMode) return state.isSpaceHeld && zoomAllowsPan;
    return zoomAllowsPan;
  }

  function endVideoPan() {
    const wasPanning = state.isPanningVideo;
    state.isPanningVideo = false;
    elements.videoWrapper?.classList.remove('panning');
    return wasPanning;
  }

  /**
   * 비디오 줌 적용
   */
  function applyVideoZoom() {
    const video = elements.videoPlayer;
    if (shouldCenterVideo()) {
      state.videoPanX = 0;
      state.videoPanY = 0;
    }

    const scale = state.videoZoom / 100;

    video.style.transform = `scale(${scale}) translate(${state.videoPanX}px, ${state.videoPanY}px)`;
    video.style.transformOrigin = 'center center';

    // 줌 디스플레이 업데이트
    if (elements.videoZoomDisplay) {
      elements.videoZoomDisplay.textContent = `${Math.round(state.videoZoom)}%`;
    }

    elements.videoWrapper?.classList.toggle('zoomed', canPanVideo());
    elements.videoWrapper?.classList.toggle('center-locked', shouldCenterVideo());

    // 캔버스도 동일하게 적용
    syncCanvasZoom();
    syncMpvEmbedBounds();
    syncMpvVideoTransform();
  }

  let mpvReviewFreezeElement = null;
  let mpvReviewFreezeToken = 0;
  let mpvReviewFreezeHostHideOwner = null;
  let mpvReviewFreezeFailureHandling = false;
  let mpvReviewFreezeFrameSnapshot = null;
  let mpvReviewTargetFrameSnapshot = null;
  let mpvDrawPlaybackTransitionToken = 0;
  let pendingMpvReviewFreezeMediaChange = null;
  const mpvReviewFrameTracker = createMpvReviewFrameTracker();
  const mpvReviewFreezeCaptureOwner = createSharedAsyncCaptureOwner();
  const mpvReviewFreezeRefreshScheduler = createCoalescedAsyncScheduler({
    delayMs: 160,
    shouldRun: () => isMpvReviewInteractionActive() && isMpvPilotPlaybackActive(),
    run: async () => {
      if (videoPlayer.isSeeking()) {
        scheduleMpvReviewFreezeRefresh();
        return false;
      }
      return refreshMpvReviewFreezeFrameForCurrentFrame();
    },
    onError: error => {
      log.warn('mpv 리뷰 정지 프레임 새로고침 실패', { error: error.message });
    }
  });

  /**
   * 캔버스 및 마커 컨테이너 줌 동기화
   */
  function syncCanvasZoom() {
    const scale = state.videoZoom / 100;
    const transform = `scale(${scale}) translate(${state.videoPanX}px, ${state.videoPanY}px)`;

    [
      elements.layersBelowCanvas,
      elements.drawingCanvas,
      elements.layersAboveCanvas,
      elements.selectionOverlayCanvas
    ].forEach((canvas) => {
      if (!canvas) return;
      canvas.style.transform = transform;
      canvas.style.transformOrigin = 'center center';
    });
    if (elements.onionSkinCanvas) {
      elements.onionSkinCanvas.style.transform = transform;
      elements.onionSkinCanvas.style.transformOrigin = 'center center';
    }
    if (elements.compositionLayerOverlay) {
      elements.compositionLayerOverlay.style.transform = transform;
      elements.compositionLayerOverlay.style.transformOrigin = 'center center';
    }
    // 마커 컨테이너도 동일하게 적용 (영상 확대 시 마커가 따라다님)
    if (markerContainer) {
      markerContainer.style.transform = transform;
      markerContainer.style.transformOrigin = 'center center';
    }
    if (videoTransitionFreezeCanvas) {
      videoTransitionFreezeCanvas.style.transform = transform;
      videoTransitionFreezeCanvas.style.transformOrigin = 'center center';
    }
    if (mpvReviewFreezeElement) {
      mpvReviewFreezeElement.style.transform = transform;
      mpvReviewFreezeElement.style.transformOrigin = 'center center';
    }
    scheduleMpvOverlayStateSync();
  }

  /**
   * 줌 인디케이터 표시
   */
  function showZoomIndicator(zoom) {
    if (!elements.zoomIndicatorOverlay) return;

    elements.zoomIndicatorOverlay.textContent = `${Math.round(zoom)}%`;
    elements.zoomIndicatorOverlay.classList.add('visible');
    scheduleMpvOverlayStateSync();

    clearTimeout(window._zoomIndicatorTimeout);
    window._zoomIndicatorTimeout = setTimeout(() => {
      elements.zoomIndicatorOverlay.classList.remove('visible');
      scheduleMpvOverlayStateSync();
      setTimeout(() => {
        if (!elements.zoomIndicatorOverlay?.classList.contains('visible')) {
          scheduleMpvOverlayStateSync({ force: true });
        }
      }, MPV_OVERLAY_FADE_OUT_SYNC_DELAY_MS);
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

  function updateVideoCenterLockButton() {
    const button = elements.btnVideoCenterLock;
    if (!button) return;

    button.classList.toggle('active', state.videoCenterLocked);
    button.setAttribute('aria-pressed', String(state.videoCenterLocked));
    button.title = state.videoCenterLocked
      ? '화면 중앙 고정 켜짐'
      : '화면 중앙 고정 꺼짐 - 축소 상태에서도 드래그 가능';
  }

  function setVideoCenterLocked(locked) {
    state.videoCenterLocked = !!locked;
    userSettings.setVideoCenterLocked(state.videoCenterLocked);
    updateVideoCenterLockButton();
    applyVideoZoom();
  }

  updateVideoCenterLockButton();

  elements.btnVideoCenterLock?.addEventListener('click', () => {
    setVideoCenterLocked(!state.videoCenterLocked);
  });

  // 비디오 영역 휠 줌
  elements.viewerContainer?.addEventListener('wheel', (e) => {
    // 피드백 30: 드로잉 모드에서도 휠 줌을 허용한다.
    // 단 획을 긋는 도중에는 좌표계가 흔들리지 않게 줌을 막는다.
    if (state.isDrawMode && drawingManager.drawingCanvas.isDrawing) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -25 : 25;
    setVideoZoom(state.videoZoom + delta);
  }, { passive: false });

  // 비디오 패닝
  elements.videoWrapper?.addEventListener('mousedown', (e) => {
    if (getCommentEditableTarget(e.target)) return;

    if (canStartFullscreenMiddleScrub(e)) {
      startFullscreenMiddleScrub(e);
      return;
    }

    if (canPanVideo() && e.button === 0) {
      if (state.isSpaceHeld) state.spacePanUsed = true;
      state.isPanningVideo = true;
      state.panStartX = e.clientX;
      state.panStartY = e.clientY;
      state.panInitialX = state.videoPanX;
      state.panInitialY = state.videoPanY;
      elements.videoWrapper.classList.add('panning');
      e.preventDefault();
    }
  });

  elements.videoWrapper?.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (state.isFullscreenScrubbing) {
      updateFullscreenMiddleScrub(e);
      return;
    }

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
    if (state.isFullscreenScrubbing) {
      finishFullscreenMiddleScrub();
    }

    endVideoPan();
  });

  window.addEventListener('blur', () => {
    endVideoPan();
    state.isSpaceHeld = false;
    state.spacePanUsed = false;
    elements.videoWrapper?.classList.remove('space-pan');
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

  const FABRIC_DRAWING_LEGACY_SHORTCUTS = new Set([
    'undo',
    'redo',
    'drawMode',
    'drawingLayerAdd',
    'drawingLayerDelete',
    'drawingLayerSelectUp',
    'drawingLayerSelectDown',
    'drawingLayerMoveUp',
    'drawingLayerMoveDown',
    'drawingLayerVisibilityToggle',
    'drawingLayerLockToggle',
    'keyframeDelete',
    'keyframeAddWithCopy',
    'keyframeAddBlank',
    'keyframeAddBlank2',
    'keyframeConvertToFrame',
    'keyframeConvertToKeyframe',
    'insertFrame',
    'deleteFrame',
    'frameCopy',
    'framePaste',
    'onionSkinToggle',
    'brushSizeDown',
    'brushSizeUp',
    'drawingToolSelect'
  ]);
  const FABRIC_DRAWING_LEGACY_CLICK_SELECTOR = [
    '#drawingTools',
    '#btnUndo',
    '#btnClearDrawing',
    '#btnAddLayer',
    '#btnDeleteLayer',
    '.layer-settings-popup',
    '.layer-action-btn',
    '.drawing-layer-header',
    '.drawing-track-row'
  ].join(',');

  function shouldBlockFabricDrawingLegacyShortcut(event) {
    if (!isFabricDrawingPilotEngaged()) return false;
    const key = String(event.key || '').toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ['c', 'v', 'z', 'y'].includes(key)) return true;
    if (event.code === 'KeyE' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      return true;
    }
    return [...FABRIC_DRAWING_LEGACY_SHORTCUTS]
      .some(action => userSettings.matchShortcut(action, event));
  }

  function handleFabricDrawingPilotLegacyClick(event) {
    if (!isFabricDrawingPilotEngaged()) return;
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest(FABRIC_DRAWING_LEGACY_CLICK_SELECTOR)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // 키보드 단축키
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('keyup', handleKeyup, true);
  document.addEventListener('click', handleFabricDrawingPilotLegacyClick, true);

  // ====== 캔버스 오버레이 동기화 ======

  /**
   * 비디오의 실제 렌더링 영역 계산
   * object-fit: contain 사용 시 레터박스/필러박스 영역을 제외한 실제 비디오 영역
   */
  function getVideoRenderArea() {
    const video = elements.videoPlayer;
    const container = elements.videoWrapper;

    const videoWidth = videoPlayer.engine !== 'html5' ? videoPlayer.videoWidth : video?.videoWidth;
    const videoHeight = videoPlayer.engine !== 'html5' ? videoPlayer.videoHeight : video?.videoHeight;

    if (!video || !container || !videoWidth || !videoHeight) {
      return null;
    }

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

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

  // ====== 댓글/그리기 모드 mpv 정지 프레임 ======
  function isMpvPilotPlaybackActive() {
    return videoPlayer.engine !== 'html5' && document.body.classList.contains('mpv-pilot-mode');
  }

  function getFabricDrawingPilotViewport() {
    const renderArea = getVideoRenderArea();
    if (!renderArea) return null;
    const viewport = {
      canvasRect: {
        left: renderArea.left,
        top: renderArea.top,
        width: renderArea.width,
        height: renderArea.height
      },
      scale: Math.max(0.01, Number(state.videoZoom) / 100 || 1),
      panX: Number(state.videoPanX) || 0,
      panY: Number(state.videoPanY) || 0,
      devicePixelRatio: window.devicePixelRatio || 1
    };
    const signature = [
      viewport.canvasRect.left,
      viewport.canvasRect.top,
      viewport.canvasRect.width,
      viewport.canvasRect.height,
      viewport.scale,
      viewport.panX,
      viewport.panY,
      viewport.devicePixelRatio
    ].join('|');
    if (signature !== fabricDrawingViewportSignature) {
      fabricDrawingViewportSignature = signature;
      fabricDrawingViewportRevision += 1;
    }
    return { ...viewport, revision: fabricDrawingViewportRevision };
  }

  function getFabricDrawingPilotContext() {
    const viewport = getFabricDrawingPilotViewport();
    return {
      isMpvActive: isMpvPilotPlaybackActive(),
      isAudio: state.isAudioMode,
      stableVideoIdentity: videoPlayer.filePath || state.currentFile || '',
      targetFrame: videoPlayer.currentFrame,
      sourceWidth: videoPlayer.videoWidth,
      sourceHeight: videoPlayer.videoHeight,
      canvasRect: viewport?.canvasRect || null,
      viewportRevision: viewport?.revision ?? 0,
      viewportTransform: viewport
        ? { scale: viewport.scale, panX: viewport.panX, panY: viewport.panY }
        : null
    };
  }

  function shouldSuppressLegacyDrawingForFabricPilot() {
    return fabricDrawingPilotController.isEnabled() && isMpvPilotPlaybackActive();
  }

  function isFabricDrawingPilotControllerEngaged() {
    const pilotState = fabricDrawingPilotController.getState();
    return fabricDrawingPilotController.isEnabled() &&
      (pilotState === 'active' || pilotState === 'preparing' || pilotState === 'recovering');
  }

  function isFabricDrawingPilotEngaged() {
    return isMpvPilotPlaybackActive() && isFabricDrawingPilotControllerEngaged();
  }

  function requiresMpvReviewFreeze() {
    return state.isCommentMode ||
      (state.isDrawMode && !fabricDrawingPilotController.isActiveOrPreparing());
  }

  function isMpvReviewInteractionActive() {
    return requiresMpvReviewFreeze();
  }

  function invalidateMpvReviewFreezeForFrameChange() {
    if (mpvReviewFrameTracker.isSamePosition(
      mpvReviewTargetFrameSnapshot,
      videoPlayer.filePath,
      videoPlayer.currentFrame
    )) {
      return false;
    }
    mpvReviewFrameTracker.invalidate();
    mpvReviewTargetFrameSnapshot = mpvReviewFrameTracker.capture(
      videoPlayer.filePath,
      videoPlayer.currentFrame
    );
    if (state.isDrawMode) {
      drawModePreparationToken += 1;
      setDrawModeReadyState(false);
      setDrawModePreparingState(true);
    }
    if (state.isCommentMode) {
      commentModePreparationToken += 1;
      setCommentModeReadyState(false);
      setCommentModePreparingState(true);
    }
    return true;
  }

  function captureCurrentMpvReviewFrameTarget() {
    if (!mpvReviewFrameTracker.isSamePosition(
      mpvReviewTargetFrameSnapshot,
      videoPlayer.filePath,
      videoPlayer.currentFrame
    )) {
      mpvReviewFrameTracker.invalidate();
      mpvReviewTargetFrameSnapshot = mpvReviewFrameTracker.capture(
        videoPlayer.filePath,
        videoPlayer.currentFrame
      );
    }
    return mpvReviewFrameTracker.capture(videoPlayer.filePath, videoPlayer.currentFrame);
  }

  async function refreshMpvReviewFreezeFrameForCurrentFrame() {
    const drawPreparationToken = drawModePreparationToken;
    const commentPreparationToken = commentModePreparationToken;
    const isDrawPreparationCurrent = () => (
      state.isDrawMode && drawPreparationToken === drawModePreparationToken
    );
    const isCommentPreparationCurrent = () => (
      state.isCommentMode && commentPreparationToken === commentModePreparationToken
    );

    return runMpvReviewFreezeRefresh({
      prepareFreeze: () => showMpvReviewFreezeFrame(),
      isStillActive: () => (
        isMpvPilotPlaybackActive() &&
        (isDrawPreparationCurrent() || isCommentPreparationCurrent())
      ),
      setReady: () => {
        if (isDrawPreparationCurrent()) {
          setDrawModePreparingState(false);
          setDrawModeReadyState(true);
        }
        if (isCommentPreparationCurrent()) {
          setCommentModePreparingState(false);
          setCommentModeReadyState(true);
        }
      },
      scheduleRetry: scheduleMpvReviewFreezeRefresh
    });
  }

  function disableMpvReviewInteractionAfterFreezeFailure() {
    if (mpvReviewFreezeFailureHandling) return;

    mpvReviewFreezeFailureHandling = true;
    try {
      if (state.isDrawMode || isFabricDrawingPilotControllerEngaged()) {
        exitDrawModeForSystemPath();
      }
      if (state.isCommentMode) {
        commentManager.setCommentMode(false);
      }
      showToast('mpv 화면을 준비하지 못해 댓글·그리기 모드를 종료했습니다.', 'error');
    } finally {
      mpvReviewFreezeFailureHandling = false;
    }
  }

  async function showMpvReviewFreezeFrame() {
    if (!isMpvPilotPlaybackActive() || !isMpvReviewInteractionActive()) return false;

    return mpvReviewFreezeCaptureOwner.capture(async () => {
      const token = ++mpvReviewFreezeToken;
      const captureFrameSnapshot = captureCurrentMpvReviewFrameTarget();
      const hadValidFrame = Boolean(
        mpvReviewFreezeElement &&
        elements.videoWrapper?.classList.contains('mpv-review-freeze-ready') &&
        mpvReviewFrameTracker.isCurrent(
          mpvReviewFreezeFrameSnapshot,
          videoPlayer.filePath,
          videoPlayer.currentFrame
        )
      );

      try {
        return await runMpvReviewFreezeCapture({
          captureFrame: async () => {
            if (!window.electronAPI?.mpvScreenshot) {
              throw new Error('mpv screenshot API unavailable');
            }
            return window.electronAPI.mpvScreenshot();
          },
          createCandidate: dataUrl => {
            const candidate = new Image();
            candidate.className = 'mpv-review-freeze-frame';
            candidate.alt = '';
            candidate.src = dataUrl;
            return candidate;
          },
          decodeCandidate: candidate => candidate.decode(),
          isCurrent: () => (
            token === mpvReviewFreezeToken &&
            isMpvReviewInteractionActive() &&
            mpvReviewFrameTracker.isCurrent(
              captureFrameSnapshot,
              videoPlayer.filePath,
              videoPlayer.currentFrame
            )
          ),
          hasValidFrame: hadValidFrame,
          beginInitialHide: () => {
            mpvReviewFreezeHostHideOwner = token;
            mpvHostLastRequestedVisible = false;
          },
          commitCandidate: candidate => {
            const renderArea = getVideoRenderArea();
            if (renderArea) {
              candidate.style.left = `${renderArea.left}px`;
              candidate.style.top = `${renderArea.top}px`;
              candidate.style.width = `${renderArea.width}px`;
              candidate.style.height = `${renderArea.height}px`;
            }

            const previousFreezeElement = mpvReviewFreezeElement;
            if (previousFreezeElement?.isConnected) {
              previousFreezeElement.replaceWith(candidate);
            } else {
              const anchor = elements.onionSkinCanvas;
              if (anchor && anchor.parentElement === elements.videoWrapper) {
                elements.videoWrapper.insertBefore(candidate, anchor);
              } else if (elements.videoWrapper) {
                elements.videoWrapper.insertBefore(candidate, elements.videoWrapper.firstChild);
              }
            }

            mpvReviewFreezeElement = candidate;
            mpvReviewFreezeFrameSnapshot = captureFrameSnapshot;
            syncCanvasZoom();
          },
          hideNativeHost: async () => {
            if (!window.electronAPI?.mpvSetHostVisible) {
              throw new Error('mpv 호스트 표시 API를 찾을 수 없습니다.');
            }
            return window.electronAPI.mpvSetHostVisible(false);
          },
          didHideApply: result => didMpvHostVisibilityApply(result, false),
          markCandidateReady: () => {
            elements.videoWrapper?.classList.add('mpv-review-freeze-ready');
            mpvHostLastRequestedVisible = false;
          },
          endInitialHide: () => {
            if (mpvReviewFreezeHostHideOwner === token) {
              mpvReviewFreezeHostHideOwner = null;
            }
          },
          rollbackCandidate: candidate => {
            elements.videoWrapper?.classList.remove('mpv-review-freeze-ready');
            candidate.remove();
            if (mpvReviewFreezeElement === candidate) {
              mpvReviewFreezeElement = null;
              mpvReviewFreezeFrameSnapshot = null;
            }
          },
          restoreNativeHost: async () => {
            mpvHostLastRequestedVisible = null;
            if (!window.electronAPI?.mpvSetHostVisible) return false;
            try {
              const result = await window.electronAPI.mpvSetHostVisible(true);
              if (result?.success) {
                mpvHostLastRequestedVisible = true;
                return true;
              }
            } catch (error) {
              log.debug('mpv 리뷰 정지 프레임 실패 후 호스트 복원 예외', { error: error.message });
            }
            forceMpvHostVisibilitySync();
            return false;
          },
          resyncAfterStale: () => resyncMpvHostVisibilityForCurrentState()
        });
      } catch (error) {
        if (token !== mpvReviewFreezeToken || !isMpvReviewInteractionActive()) return false;
        log.warn('mpv 리뷰 정지 프레임 준비 실패', { error: error.message });
        if (!hadValidFrame) {
          disableMpvReviewInteractionAfterFreezeFailure();
        }
        return hadValidFrame;
      }
    });
  }

  async function releaseMpvReviewFreezeFrame() {
    const token = ++mpvReviewFreezeToken;
    const freezeElement = mpvReviewFreezeElement;

    mpvReviewFreezeCaptureOwner.cancel();
    mpvReviewFreezeRefreshScheduler.cancel();
    mpvReviewFreezeHostHideOwner = null;

    elements.videoWrapper?.classList.remove('mpv-review-freeze-ready');

    const shouldRestoreNativeHost = isMpvPilotPlaybackActive() && !hasBlockingOverlayForMpv();
    if (shouldRestoreNativeHost) {
      if (!window.electronAPI?.mpvSetHostVisible) {
        log.warn('mpv 호스트 복원 API를 찾지 못해 정지 프레임을 유지합니다.');
        return false;
      }

      try {
        mpvHostLastRequestedVisible = null;
        const result = await window.electronAPI.mpvSetHostVisible(true);
        if (token !== mpvReviewFreezeToken) return;
        if (!result?.success) {
          log.warn('mpv 호스트 복원 실패, 정지 프레임을 유지합니다.', { error: result?.error });
          return false;
        }
        mpvHostLastRequestedVisible = true;
      } catch (error) {
        if (token !== mpvReviewFreezeToken) return;
        log.warn('mpv 호스트 복원 예외, 정지 프레임을 유지합니다.', { error: error.message });
        return false;
      }
    }

    if (token !== mpvReviewFreezeToken) return;
    if (freezeElement) {
      freezeElement.remove();
      if (mpvReviewFreezeElement === freezeElement) {
        mpvReviewFreezeElement = null;
      }
    }
    mpvReviewFreezeFrameSnapshot = null;
    mpvReviewTargetFrameSnapshot = null;
    return true;
  }

  async function restoreMpvDrawFreezeAfterPlayback() {
    const restoreToken = ++mpvDrawPlaybackTransitionToken;
    const freezePrepared = await showMpvReviewFreezeFrame();
    if (
      restoreToken !== mpvDrawPlaybackTransitionToken ||
      !state.isDrawMode ||
      videoPlayer.isPlaying
    ) return;

    if (!freezePrepared) {
      elements.drawingTools?.classList.remove('playback-hidden');
      scheduleMpvReviewFreezeRefresh();
      forceMpvHostVisibilitySync();
      return false;
    }

    elements.drawingTools?.classList.remove('playback-hidden');
    scheduleMpvOverlayStateSync({ force: true });
    forceMpvHostVisibilitySync();
    return true;
  }

  function preserveMpvReviewFreezeFrameForMediaChange() {
    const canPreserve = Boolean(
      mpvReviewFreezeElement &&
      elements.videoWrapper?.classList.contains('mpv-review-freeze-ready')
    );
    if (!canPreserve) return false;

    mpvReviewFreezeToken += 1;
    mpvReviewFrameTracker.invalidate();
    mpvReviewTargetFrameSnapshot = null;
    mpvReviewFreezeCaptureOwner.cancel();
    mpvReviewFreezeRefreshScheduler.cancel();
    mpvReviewFreezeHostHideOwner = null;
    drawModePreparationToken += 1;
    setDrawModeReadyState(false);
    setDrawModePreparingState(true);
    return true;
  }

  function beginDestructiveMpvReviewMediaChange(loadToken) {
    if (activeVideoLoadToken !== loadToken) return null;

    pendingMpvReviewFreezeMediaChange = Object.freeze({
      loadToken,
      filePath: videoPlayer.filePath || state.currentFile,
      frame: videoPlayer.currentFrame
    });
    return pendingMpvReviewFreezeMediaChange;
  }

  async function settlePendingMpvReviewFreezeMediaChange({ loaded = false } = {}) {
    const transition = pendingMpvReviewFreezeMediaChange;
    if (!transition) return false;
    pendingMpvReviewFreezeMediaChange = null;
    if (loaded) return true;

    elements.videoWrapper?.classList.remove('mpv-pilot-mode');
    document.body.classList.remove('mpv-pilot-mode');
    mpvHostLastRequestedVisible = null;
    videoPlayer.useHtml5Engine();
    videoPlayer.isLoaded = false;
    if (state.isDrawMode || isFabricDrawingPilotControllerEngaged()) {
      exitDrawModeForSystemPath();
    }
    if (state.isCommentMode) {
      commentManager.setCommentMode(false);
    }
    forceRemoveMpvReviewFreezeFrame();
    try {
      await stopMpvPilotEngine();
    } catch (error) {
      log.warn('중단된 영상 전환의 mpv 정리 실패', { error: error.message });
    }
    log.warn('영상 전환이 중단되어 보존 중이던 리뷰 화면을 안전하게 종료했습니다.', {
      filePath: transition.filePath,
      frame: transition.frame
    });
    return false;
  }

  function forceRemoveMpvReviewFreezeFrame() {
    mpvReviewFreezeToken += 1;
    mpvReviewFreezeCaptureOwner.cancel();
    mpvReviewFreezeRefreshScheduler.cancel();
    mpvReviewFreezeHostHideOwner = null;
    elements.videoWrapper?.classList.remove('mpv-review-freeze-ready');
    mpvReviewFreezeElement?.remove();
    mpvReviewFreezeElement = null;
    mpvReviewFreezeFrameSnapshot = null;
    mpvReviewTargetFrameSnapshot = null;
  }

  function scheduleMpvReviewFreezeRefresh() {
    mpvReviewFreezeRefreshScheduler.schedule();
  }

  /**
   * 캔버스 오버레이를 비디오 실제 영역에 맞게 동기화
   */
  function syncCanvasOverlay() {
    const renderArea = getVideoRenderArea();
    const canvas = elements.drawingCanvas;
    const layerCanvases = [
      elements.layersBelowCanvas,
      elements.drawingCanvas,
      elements.layersAboveCanvas,
      elements.selectionOverlayCanvas
    ];
    const onionCanvas = elements.onionSkinCanvas;
    const compositionOverlay = elements.compositionLayerOverlay;

    if (!renderArea || !canvas) {
      return;
    }

    // 그리기 캔버스 위치와 크기를 비디오 실제 렌더 영역에 맞춤
    layerCanvases.forEach((layerCanvas) => {
      if (!layerCanvas) return;
      layerCanvas.style.position = 'absolute';
      layerCanvas.style.left = `${renderArea.left}px`;
      layerCanvas.style.top = `${renderArea.top}px`;
      layerCanvas.style.width = `${renderArea.width}px`;
      layerCanvas.style.height = `${renderArea.height}px`;
    });

    // 어니언 스킨 캔버스도 동일하게 동기화
    if (onionCanvas) {
      onionCanvas.style.position = 'absolute';
      onionCanvas.style.left = `${renderArea.left}px`;
      onionCanvas.style.top = `${renderArea.top}px`;
      onionCanvas.style.width = `${renderArea.width}px`;
      onionCanvas.style.height = `${renderArea.height}px`;
    }

    if (compositionOverlay) {
      compositionOverlay.style.position = 'absolute';
      compositionOverlay.style.left = `${renderArea.left}px`;
      compositionOverlay.style.top = `${renderArea.top}px`;
      compositionOverlay.style.width = `${renderArea.width}px`;
      compositionOverlay.style.height = `${renderArea.height}px`;
      compositionLayerManager.renderOverlay();
    }

    if (mpvReviewFreezeElement) {
      mpvReviewFreezeElement.style.left = `${renderArea.left}px`;
      mpvReviewFreezeElement.style.top = `${renderArea.top}px`;
      mpvReviewFreezeElement.style.width = `${renderArea.width}px`;
      mpvReviewFreezeElement.style.height = `${renderArea.height}px`;
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
    renderCompositionLayerTimeline();
    scheduleMpvOverlayStateSync();
  }

  // 윈도우 리사이즈 시 캔버스 동기화
  window.addEventListener('resize', () => {
    syncCanvasOverlay();
    syncMpvEmbedBounds();
  });

  // ResizeObserver로 컨테이너 크기 변경 감지
  const resizeObserver = new ResizeObserver(() => {
    syncCanvasOverlay();
    syncMpvEmbedBounds();
  });
  resizeObserver.observe(elements.videoWrapper);
  syncMpvEmbedBounds();

  // ====== 헬퍼 함수 ======

  // ====== 트랜스코딩 상태 관리 ======
  let isTranscoding = false;
  let transcodeResolve = null;
  let activeTranscodeOverlayToken = 0;
  let activeTranscodeOverlayCleanup = null;
  let latestVideoLoadToken = 0;
  let activeVideoLoadToken = null;
  let activeVideoLoadPath = null;
  let activeMpvPilotLoadToken = null;
  let deferredReviewFileDiscovery = null;
  const DEFERRED_REVIEW_FILE_POLL_INTERVAL_MS = 3000;

  function hasActiveVideoLoadForDifferentFile(filePath) {
    return typeof activeVideoLoadPath === 'string' && !isSameFilePath(activeVideoLoadPath, filePath);
  }

  function invalidateActiveVideoLoad() {
    latestVideoLoadToken += 1;
    supersedeActiveTranscodeOverlay('재생목록 교체');
  }

  function isStaleVideoLoadToken(loadToken) {
    return loadToken !== latestVideoLoadToken;
  }

  function supersedeActiveTranscodeOverlay(reason = 'stale') {
    activeTranscodeOverlayToken += 1;

    if (typeof activeTranscodeOverlayCleanup === 'function') {
      activeTranscodeOverlayCleanup(true);
      activeTranscodeOverlayCleanup = null;
    }

    const overlay = document.getElementById('transcodeOverlay');
    overlay?.classList.remove('active');
    isTranscoding = false;

    if (transcodeResolve) {
      const resolve = transcodeResolve;
      transcodeResolve = null;
      resolve({ success: false, stale: true, error: reason });
    }
  }

  function isCurrentReviewPath(bframePath) {
    return !!bframePath && isSameFilePath(reviewDataManager.currentBframePath, bframePath);
  }

  function isDeferredReviewFileDiscoveryActive(bframePath) {
    return !!deferredReviewFileDiscovery &&
      isSameFilePath(deferredReviewFileDiscovery.bframePath, bframePath);
  }

  async function stopDeferredReviewFileDiscovery(bframePath = null) {
    if (!deferredReviewFileDiscovery) return;
    if (bframePath && !isSameFilePath(deferredReviewFileDiscovery.bframePath, bframePath)) return;

    const { bframePath: pendingPath, pollTimer } = deferredReviewFileDiscovery;
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    deferredReviewFileDiscovery = null;
    try {
      await window.electronAPI.watchFileStop(pendingPath);
    } catch (error) {
      log.warn('지연 .bframe 생성 감지 중지 실패', { path: pendingPath, error: error.message });
    }
    log.info('지연 .bframe 생성 감지 중지', { path: pendingPath });
  }

  async function handleDeferredReviewFileDiscovered(bframePath, source = 'watch') {
    if (!isDeferredReviewFileDiscoveryActive(bframePath)) return false;
    const { loadToken } = deferredReviewFileDiscovery;
    if (isStaleVideoLoadToken(loadToken) || !isCurrentReviewPath(bframePath)) return false;

    let exists = false;
    try {
      exists = await window.electronAPI.fileExists(bframePath);
    } catch (error) {
      log.debug('지연 .bframe 존재 확인 실패', { path: bframePath, error: error.message });
    }
    if (!exists) return false;

    log.info('지연 .bframe 생성 감지됨', { path: bframePath, source });
    const synced = await syncReviewFileFromDisk(bframePath, {
      startCollaborationIfNeeded: true,
      bypassDebounce: true,
      replaceDeferredDiscovery: true,
      source
    });
    return synced;
  }

  function startDeferredReviewFileDiscovery(loadToken, bframePath) {
    if (!bframePath || isStaleVideoLoadToken(loadToken)) return;

    void stopDeferredReviewFileDiscovery();
    const pollTimer = setInterval(() => {
      void handleDeferredReviewFileDiscovered(bframePath, 'poll');
    }, DEFERRED_REVIEW_FILE_POLL_INTERVAL_MS);

    deferredReviewFileDiscovery = {
      bframePath,
      loadToken,
      pollTimer
    };

    void window.electronAPI.watchFileStart(bframePath).then((result) => {
      if (!result?.success) {
        log.debug('지연 .bframe 파일 감시 시작 실패, 폴링으로 대체', {
          path: bframePath,
          error: result?.error
        });
      }
    });

    log.info('지연 .bframe 생성 감지 시작', { path: bframePath });
  }

  async function stopStaleCollaborationRoom(roomId) {
    if (!roomId || liveblocksManager.roomId !== roomId) return;
    try {
      playbackSync.stop();
      drawingSync.stop();
      commentSync.stop();
      await liveblocksManager.stop();
    } catch (error) {
      log.warn('이전 협업 세션 정리 실패', { error: error.message });
    }
  }

  async function startCollaborationForVideoLoad(loadToken, bframePath, options = {}) {
    const {
      persistNewRoom = true,
      seedCurrentState = false
    } = options;
    if (isStaleVideoLoadToken(loadToken) || !isCurrentReviewPath(bframePath)) return false;

    const userName = userSettings.getUserName();
    const userColor = userSettings.getColorForName(userName) || '#4a9eff';
    let startedRoomId = null;

    try {
      const bframeData = await window.electronAPI.loadReview(bframePath);
      if (isStaleVideoLoadToken(loadToken) || !isCurrentReviewPath(bframePath)) return false;
      const existingRoomId = bframeData?.liveblocksRoomId || null;

      const { roomId, isNewRoom } = await liveblocksManager.start(
        bframePath,
        userName,
        userColor,
        existingRoomId
      );
      startedRoomId = roomId;
      if (isStaleVideoLoadToken(loadToken) || !isCurrentReviewPath(bframePath)) {
        await stopStaleCollaborationRoom(roomId);
        return false;
      }

      if (isNewRoom && isCurrentReviewPath(bframePath)) {
        reviewDataManager.setLiveblocksRoomId(roomId);
        if (persistNewRoom) {
          await reviewDataManager.save({ skipMerge: true });
          if (isStaleVideoLoadToken(loadToken) || !isCurrentReviewPath(bframePath)) {
            await stopStaleCollaborationRoom(roomId);
            return false;
          }
        }
      }

      await commentSync.start();
      if (isStaleVideoLoadToken(loadToken) || !isCurrentReviewPath(bframePath)) {
        await stopStaleCollaborationRoom(roomId);
        return false;
      }
      drawingSync.start();
      playbackSync.start();
      if (seedCurrentState) {
        commentSync.broadcastCurrentState?.();
        drawingSync.broadcastCurrentState?.();
      }
      log.info('Liveblocks 협업 세션 시작됨', { roomId, isNewRoom });
    } catch (error) {
      log.warn('Liveblocks 연결 실패, 로컬 모드로 계속', { error: error.message });
    }

    if (isStaleVideoLoadToken(loadToken) || !isCurrentReviewPath(bframePath)) {
      await stopStaleCollaborationRoom(startedRoomId);
      return false;
    }

    try {
      await window.electronAPI.watchFileStart(bframePath);
      if (isStaleVideoLoadToken(loadToken) || !isCurrentReviewPath(bframePath)) return false;
      log.info('파일 감시 시작됨', { path: bframePath });
    } catch (error) {
      log.warn('파일 감시 시작 실패', { path: bframePath, error: error.message });
    }

    return true;
  }

  function scheduleDeferredCollaborationStart(loadToken, bframePath) {
    const start = () => {
      void startCollaborationForVideoLoad(loadToken, bframePath);
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(start, { timeout: 500 });
    } else {
      setTimeout(start, 0);
    }
  }

  async function prepareReviewFileBeforeSave({ path: bframePath, hasPersistedFile }) {
    if (!bframePath || hasPersistedFile || !isCurrentReviewPath(bframePath)) return;

    await stopDeferredReviewFileDiscovery(bframePath);

    let fileExists = false;
    try {
      fileExists = await window.electronAPI.fileExists(bframePath);
    } catch (error) {
      log.debug('첫 .bframe 저장 전 파일 존재 확인 실패', {
        path: bframePath,
        error: error.message
      });
    }

    if (fileExists) {
      log.info('첫 저장 전 기존 .bframe 발견, 병합 후 협업 시작', { path: bframePath });
      await reviewDataManager.reloadAndMerge({ merge: true, force: true, preserveLocal: true });
      await startCollaborationForVideoLoad(latestVideoLoadToken, bframePath, {
        persistNewRoom: false,
        seedCurrentState: true
      });
      return;
    }

    await startCollaborationForVideoLoad(latestVideoLoadToken, bframePath, {
      persistNewRoom: false,
      seedCurrentState: true
    });
  }

  async function handleInitialReviewFileSaveConflict({ path: bframePath }) {
    if (!bframePath || !isCurrentReviewPath(bframePath)) return;

    log.info('첫 .bframe 저장 충돌 처리 시작', { path: bframePath });
    const mergeResult = await reviewDataManager.reloadAndMerge({ merge: true, force: true, preserveLocal: true });
    if (!mergeResult.success) {
      return mergeResult;
    }
    await startCollaborationForVideoLoad(latestVideoLoadToken, bframePath, {
      persistNewRoom: false,
      seedCurrentState: true
    });
    return mergeResult;
  }

  async function prepareCompositionLayerMedia(filePath) {
    if (isAlphaPreservingCompositionMedia(filePath)) {
      return { status: 'ready', filePath, message: '원본 사용' };
    }

    const api = window.electronAPI;
    if (!filePath || !api?.ffmpegIsAvailable || !api?.ffmpegProbeCodec || !api?.ffmpegCheckCache || !api?.ffmpegTranscode) {
      return { status: 'ready', filePath, message: '원본 사용' };
    }

    try {
      const ffmpegAvailable = await api.ffmpegIsAvailable();
      if (!ffmpegAvailable) {
        return { status: 'ready', filePath, message: 'FFmpeg 없음, 원본 사용' };
      }

      const codecInfo = await window.electronAPI.ffmpegProbeCodec(filePath);
      if (!codecInfo?.success || codecInfo.isSupported) {
        return { status: 'ready', filePath, message: '원본 사용' };
      }

      const cacheResult = await window.electronAPI.ffmpegCheckCache(filePath);
      if (cacheResult?.valid && cacheResult.convertedPath) {
        return { status: 'ready', filePath: cacheResult.convertedPath, message: '캐시 사용' };
      }

      const transcodeResult = await window.electronAPI.ffmpegTranscode(filePath);
      if (transcodeResult?.success) {
        return {
          status: 'ready',
          filePath: transcodeResult.outputPath || filePath,
          message: transcodeResult.fromCache ? '캐시 사용' : '변환 완료'
        };
      }

      return {
        status: 'error',
        filePath,
        error: transcodeResult?.error || '변환 실패'
      };
    } catch (error) {
      log.warn('합성 레이어 영상 준비 실패', { filePath, error: error?.message });
      return {
        status: 'error',
        filePath,
        error: error?.message || '변환 실패'
      };
    }
  }

  /**
   * 트랜스코딩 오버레이 표시 및 진행
   * @param {string} filePath - 원본 파일 경로
   * @param {string} codecName - 원본 코덱 이름
   * @returns {Promise<{success: boolean, outputPath?: string, error?: string}>}
   */
  async function showTranscodeOverlay(filePath, codecName) {
    supersedeActiveTranscodeOverlay('새 변환 시작');
    const overlayToken = ++activeTranscodeOverlayToken;
    const isActiveTranscodeOverlay = () => overlayToken === activeTranscodeOverlayToken;

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
      if (!isActiveTranscodeOverlay()) return;
      if (data.filePath === filePath) {
        progressFill.style.width = `${data.progress}%`;
        percentText.textContent = `${data.progress}%`;
        statusText.textContent = data.progress < 100 ? '변환 중...' : '완료 처리 중...';
      }
    };
    const unsubscribeTranscodeProgress = window.electronAPI.onTranscodeProgress(progressHandler);
    const unsubscribePreTranscodeProgress = window.electronAPI.onPreTranscodeProgress(progressHandler);

    const cleanupTranscodeProgressListeners = (force = false) => {
      if (!force && !isActiveTranscodeOverlay()) return;
      unsubscribeTranscodeProgress?.();
      unsubscribePreTranscodeProgress?.();
      if (activeTranscodeOverlayCleanup === cleanupTranscodeProgressListeners) {
        activeTranscodeOverlayCleanup = null;
      }
    };

    return new Promise(async (resolve) => {
      transcodeResolve = resolve;

      const finish = (result) => {
        if (transcodeResolve === resolve) {
          transcodeResolve = null;
        }
        resolve(result);
      };

      const cleanupOverlay = (force = false) => {
        if (!force && !isActiveTranscodeOverlay()) return;
        isTranscoding = false;
        overlay.classList.remove('active');
        cleanupTranscodeProgressListeners(force);
        cancelBtn.removeEventListener('click', handleCancel);
        if (activeTranscodeOverlayCleanup === cleanupOverlay) {
          activeTranscodeOverlayCleanup = null;
        }
      };

      const handleCancel = async () => {
        if (!isActiveTranscodeOverlay()) return;
        activeTranscodeOverlayToken += 1;
        log.info('사용자가 트랜스코딩 취소 요청');
        await window.electronAPI.ffmpegCancel();
        cleanupOverlay(true);
        finish({ success: false, error: '사용자 취소' });
      };

      activeTranscodeOverlayCleanup = cleanupOverlay;
      cancelBtn.addEventListener('click', handleCancel, { once: true });

      try {
        const result = await window.electronAPI.ffmpegTranscode(filePath);

        if (!isActiveTranscodeOverlay()) {
          return;
        }

        cleanupOverlay();

        if (result.success) {
          log.info('트랜스코딩 완료', { outputPath: result.outputPath, fromCache: result.fromCache });
          finish({ success: true, outputPath: result.outputPath });
        } else {
          log.error('트랜스코딩 실패', { error: result.error });
          finish({ success: false, error: result.error });
        }
      } catch (error) {
        if (!isActiveTranscodeOverlay()) {
          return;
        }

        cleanupOverlay();

        log.error('트랜스코딩 예외', { error: error.message });
        finish({ success: false, error: error.message });
      }
    });
  }

  /**
   * 비디오 파일 로드
   * @param {string} filePath - 파일 경로
   * @param {Object} options - 옵션
   * @param {boolean} options.keepVersionContext - 버전 컨텍스트 유지 (수동 버전 전환 시 사용)
   * @param {number} options.targetVersion - 전환할 버전 번호 (수동 버전 선택 시)
   * @param {boolean} options.preserveContinuousSession - 이어보기 내부 로드는 현재 세션 유지
   * @param {number|null} options.initialFrame - 로드 직후 먼저 맞출 프레임
   * @param {boolean} options.revealAfterInitialSeek - 첫 프레임 노출 없이 initialFrame 준비 후 표시
   * @param {boolean} options.holdPreviousFrameUntilReady - 다음 영상 첫 화면 준비 전까지 이전 화면 유지
   * @param {boolean} options.deferCollaborationStart - 협업 접속/파일 감시를 화면 전환 뒤로 미룸
   */
  function waitForNextVideoPaint(video) {
    return new Promise(resolve => {
      if (typeof video?.requestVideoFrameCallback === 'function') {
        let settled = false;
        const timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve();
        }, 120);

        video.requestVideoFrameCallback(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve();
        });
        return;
      }

      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function waitForVideoRenderable(video, timeoutMs = 400) {
    if (!video) return Promise.resolve(false);
    if (video.readyState >= 2) return Promise.resolve(true);

    return new Promise(resolve => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('seeked', onReady);
        video.removeEventListener('error', onError);
        clearTimeout(timer);
        resolve(value);
      };
      const onReady = () => finish(video.readyState >= 2);
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(video.readyState >= 2), timeoutMs);

      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('canplay', onReady, { once: true });
      video.addEventListener('seeked', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  }

  function ensureVideoTransitionFreezeCanvas() {
    if (videoTransitionFreezeCanvas) return videoTransitionFreezeCanvas;

    const canvas = document.createElement('canvas');
    canvas.className = 'video-transition-freeze-canvas';
    canvas.hidden = true;
    elements.videoWrapper?.appendChild(canvas);
    videoTransitionFreezeCanvas = canvas;
    return canvas;
  }

  function syncVideoTransitionFreezeCanvas(renderArea) {
    const canvas = videoTransitionFreezeCanvas;
    if (!canvas || !renderArea) return;

    canvas.style.left = `${renderArea.left}px`;
    canvas.style.top = `${renderArea.top}px`;
    canvas.style.width = `${renderArea.width}px`;
    canvas.style.height = `${renderArea.height}px`;
    canvas.style.transform = elements.videoPlayer.style.transform || '';
    canvas.style.transformOrigin = elements.videoPlayer.style.transformOrigin || 'center center';
  }

  function captureVideoTransitionFreezeFrame() {
    const video = elements.videoPlayer;
    if (
      state.isAudioMode ||
      !video ||
      video.readyState < 2 ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return false;
    }

    const renderArea = getVideoRenderArea();
    if (!renderArea) return false;

    const canvas = ensureVideoTransitionFreezeCanvas();
    const context = canvas.getContext('2d');
    if (!context) return false;

    canvas.width = renderArea.videoWidth;
    canvas.height = renderArea.videoHeight;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    syncVideoTransitionFreezeCanvas(renderArea);
    canvas.hidden = false;
    return true;
  }

  function releaseVideoTransitionFreezeFrame(wasCaptured) {
    if (!wasCaptured || !videoTransitionFreezeCanvas) return;

    requestAnimationFrame(() => {
      if (videoTransitionFreezeCanvas) {
        videoTransitionFreezeCanvas.hidden = true;
      }
    });
  }

  async function seekInitialVideoFrameBeforeReveal(initialFrame) {
    const frame = Number(initialFrame);
    if (!Number.isFinite(frame) || frame <= 0 || !videoPlayer.isLoaded) return;

    const video = elements.videoPlayer;
    const fps = Number(videoPlayer.fps) > 0 ? Number(videoPlayer.fps) : 24;
    const totalFrames = Number(videoPlayer.totalFrames);
    const maxFrame = Number.isFinite(totalFrames) && totalFrames > 0
      ? totalFrames - 1
      : frame;
    const targetFrame = Math.max(0, Math.min(Math.floor(frame), maxFrame));
    const duration = Number(videoPlayer.duration) || Number(video.duration);
    const targetTime = (targetFrame / fps) + 0.001;
    const boundedTime = Number.isFinite(duration) && duration > 0
      ? Math.max(0, Math.min(targetTime, duration))
      : Math.max(0, targetTime);

    await new Promise(resolve => {
      let settled = false;
      let timeoutId = null;

      const cleanup = () => {
        video.removeEventListener('seeked', onReady);
        video.removeEventListener('error', onReady);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const onReady = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      video.addEventListener('seeked', onReady, { once: true });
      video.addEventListener('error', onReady, { once: true });
      timeoutId = setTimeout(onReady, 700);

      try {
        video.currentTime = boundedTime;
      } catch (error) {
        log.warn('초기 프레임 이동 실패', { frame: targetFrame, error: error.message });
        onReady();
      }
    });

    videoPlayer.currentFrame = targetFrame;
    videoPlayer.currentTime = targetFrame / fps;
    await waitForNextVideoPaint(video);
  }

  let mpvEmbedBoundsSyncPending = false;
  let mpvVideoTransformSyncPending = false;
  let fabricDrawingPilotFailureToastShown = false;
  let fabricDrawingPilotUiEngaged = false;
  let fabricDrawingViewportRevision = 0;
  let fabricDrawingViewportSignature = '';
  const mpvOverlayLifecycle = createMpvOverlayLifecycle({
    onWarning: (error) => {
      log.warn('mpv 오버레이 동기화 실패, 호스트 복구를 시도합니다.', {
        error: error || 'unknown'
      });
    }
  });
  const fabricDrawingPilotController = createFabricDrawingPilotController({
    electronAPI: window.electronAPI,
    getContext: getFabricDrawingPilotContext,
    persistenceStore: fabricDrawingPersistenceStore,
    onStateChange: handleFabricDrawingPilotStateChange
  });
  const fabricDrawingPilotInitialization = fabricDrawingPilotController.initialize().then(enabled => {
    document.body.classList.toggle('fabric-drawing-pilot-enabled', enabled);
    scheduleFabricPilotStatusRefresh({ force: true });
    return enabled;
  });
  const mpvTeardownGate = createMpvTeardownGate();
  const mpvPilotOwnershipGate = createMpvPilotOwnershipGate({
    teardownGate: mpvTeardownGate,
    overlayLifecycle: mpvOverlayLifecycle,
    setActiveLoadToken: (loadToken) => {
      activeMpvPilotLoadToken = loadToken;
    }
  });
  let mpvOverlayStateSyncPendingOwner = null;
  let mpvOverlayRemoteCursorSyncPendingOwner = null;
  let mpvOverlayStateSyncTimer = null;
  let mpvOverlayLastLiveDrawSyncAt = 0;
  let fabricPilotStatusText = '';
  let fabricPilotStatusRefreshTimer = null;
  let fabricPilotStatusLastRefreshAt = 0;
  const fabricPilotStatusRefreshCoordinator = createFabricPilotStatusRefreshCoordinator({
    shouldRun: () => fabricDrawingPilotController.isEnabled(),
    run: refreshFabricPilotStatus,
    onError: (error) => {
      log.debug('Fabric 수동 검증 HUD 갱신 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  let mpvOverlayRecoveryOwner = null;
  let mpvOverlayRecoveryInFlightOwner = null;
  let mpvOverlayFallbackOwner = null;
  let mpvOverlayDeferredFallback = null;
  let mpvOverlaySyncEpoch = 0;
  let expectedMpvHtml5FallbackStop = null;
  let expectedMpvHtml5FallbackStopSequence = 0;
  let mpvHostVisibilitySyncPending = false;
  let mpvHostLastRequestedVisible = null;
  let mpvPilotHostPreparing = false;
  let fullscreenTimecodeOverlay = null;
  let fullscreenScrubOverlay = null;
  let remoteCursorsContainer = null;

  function isCurrentMpvOverlayFallbackOwner(owner, filePath) {
    if (!owner || !filePath || !mpvOverlayLifecycle.owns(owner)) return false;
    if (activeMpvPilotLoadToken !== owner.loadToken) return false;
    if (activeVideoLoadToken !== null && activeVideoLoadToken !== owner.loadToken) return false;
    if (hasActiveVideoLoadForDifferentFile(filePath)) return false;

    return isSameFilePath(filePath, state.currentFile) ||
      isSameFilePath(filePath, activeVideoLoadPath);
  }

  function beginExpectedMpvHtml5FallbackStop(owner, filePath) {
    const token = ++expectedMpvHtml5FallbackStopSequence;
    expectedMpvHtml5FallbackStop = Object.freeze({ owner, filePath, token });
    return token;
  }

  function consumeExpectedMpvHtml5FallbackStop(filePath) {
    const expected = expectedMpvHtml5FallbackStop;
    if (!expected || !filePath || !isSameFilePath(expected.filePath, filePath)) return false;
    expectedMpvHtml5FallbackStop = null;
    return true;
  }

  function clearExpectedMpvHtml5FallbackStop() {
    expectedMpvHtml5FallbackStop = null;
  }

  function scheduleExpectedMpvHtml5FallbackStopCleanup(token) {
    setTimeout(() => {
      if (expectedMpvHtml5FallbackStop?.token === token) {
        expectedMpvHtml5FallbackStop = null;
      }
    }, 2000);
  }

  function beginMpvHtml5FallbackReviewTransition() {
    const drawModeWasActive = state.isDrawMode;
    const drawPreparationToken = drawModeWasActive ? ++drawModePreparationToken : null;

    if (drawModeWasActive) {
      setDrawModePreparingState(false);
      setDrawModeReadyState(false);
    }
    if (state.isCommentMode) {
      ++commentModePreparationToken;
      setCommentModePreparingState(false);
      commentManager.setCommentMode(false);
    }

    return Object.freeze({ drawModeWasActive, drawPreparationToken });
  }

  function finishMpvHtml5FallbackReviewTransition(transition, { filePath, loaded }) {
    if (!transition?.drawModeWasActive || !state.isDrawMode) return;
    if (drawModePreparationToken !== transition.drawPreparationToken) return;
    if (hasActiveVideoLoadForDifferentFile(filePath)) return;

    const html5FileReady = loaded &&
      videoPlayer.engine === 'html5' &&
      isSameFilePath(filePath, state.currentFile);
    if (html5FileReady) {
      setDrawModePreparingState(false);
      setDrawModeReadyState(true);
      return;
    }

    exitDrawModeForSystemPath();
  }

  async function loadVideoWithHtml5Fallback(filePath, options = {}, { owner = null, skipReviewTransition = false } = {}) {
    // 작업 4: 하이브리드 전환은 리뷰 모드(드로잉/댓글)를 유지한 채 엔진만 바꾸므로
    // 모드 강제 종료·토큰 무효화를 수행하는 리뷰 전이를 건너뛴다.
    const reviewTransition = skipReviewTransition ? null : beginMpvHtml5FallbackReviewTransition();
    const expectedStopToken = beginExpectedMpvHtml5FallbackStop(owner, filePath);
    let loaded = false;
    try {
      loaded = await loadVideo(filePath, {
        ...options,
        allowMpvPilot: false
      });
      return loaded;
    } finally {
      if (!skipReviewTransition) {
        finishMpvHtml5FallbackReviewTransition(reviewTransition, { filePath, loaded });
      }
      scheduleExpectedMpvHtml5FallbackStopCleanup(expectedStopToken);
    }
  }

  // 작업 4: 드로잉/댓글 모드 하이브리드 엔진 — HTML5 직재생 가능 코덱이면 모드 동안 HTML5로 전환
  const hybridReviewCodecCache = new Map(); // filePath -> boolean

  async function isHtml5DirectPlayableForReview(filePath) {
    if (!filePath) return false;
    if (hybridReviewCodecCache.has(filePath)) return hybridReviewCodecCache.get(filePath);
    let playable = false;
    try {
      // loadVideo HTML5 경로와 동일한 프로브 재사용
      const available = await window.electronAPI.ffmpegIsAvailable?.();
      if (available) {
        const codecInfo = await window.electronAPI.ffmpegProbeCodec(filePath);
        playable = codecInfo?.isSupported === true;
      }
    } catch (error) {
      log.debug('하이브리드 코덱 프로브 실패 — freeze 방식 유지', { error: error?.message });
    }
    hybridReviewCodecCache.set(filePath, playable);
    return playable;
  }

  let hybridReviewSwapInFlight = false;
  let hybridReviewResumeMpvFile = null; // 모드 종료 시 mpv로 복귀할 파일 경로

  async function enterHybridReviewEngineIfPossible() {
    if (hybridReviewSwapInFlight) return false;
    if (!userSettings.getHybridReviewEngine()) return false;
    if (!isMpvPilotPlaybackActive()) return false;
    if (state.isAudioMode || !state.currentFile) return false;
    if (!(await isHtml5DirectPlayableForReview(state.currentFile))) return false;

    hybridReviewSwapInFlight = true;
    try {
      const resumeFrame = Number.isFinite(Number(videoPlayer.currentFrame)) ? Number(videoPlayer.currentFrame) : null;
      const swapped = await loadVideoWithHtml5Fallback(state.currentFile, {
        keepVersionContext: true,
        engineSwap: true,
        initialFrame: resumeFrame,
        playWhenMediaReady: false
      }, { skipReviewTransition: true });
      if (swapped) hybridReviewResumeMpvFile = state.currentFile;
      return swapped;
    } catch (error) {
      log.warn('하이브리드 진입 실패 — freeze 방식으로 폴백', { error: error?.message });
      return false;
    } finally {
      hybridReviewSwapInFlight = false;
    }
  }

  async function exitHybridReviewEngineIfNeeded() {
    if (hybridReviewSwapInFlight) return;
    if (!hybridReviewResumeMpvFile) return;
    if (isMpvReviewInteractionActive()) return; // 아직 다른 리뷰 모드가 켜져 있음
    // 다른 파일 열기가 이미 진행돼 currentFile이 바뀌었으면 복귀하지 않는다 —
    // 아래 hybridReviewResumeMpvFile === state.currentFile 비교가 이를 차단하고,
    // (c) 말미의 정리 규칙(비-engineSwap loadVideo 초입에서 hybridReviewResumeMpvFile = null)이
    // 로드 시작 직후의 좁은 경합 창까지 닫는다. 별도 토큰 가드는 두지 않는다.
    if (videoPlayer.engine === 'html5' && hybridReviewResumeMpvFile === state.currentFile) {
      hybridReviewSwapInFlight = true;
      const resumeFrame = Number.isFinite(Number(videoPlayer.currentFrame)) ? Number(videoPlayer.currentFrame) : null;
      const resumePlayback = videoPlayer.isPlaying === true;
      try {
        await loadVideo(state.currentFile, {
          allowMpvPilot: true,
          keepVersionContext: true,
          engineSwap: true,
          initialFrame: resumeFrame,
          playWhenMediaReady: resumePlayback
        });
      } catch (error) {
        log.warn('하이브리드 복귀 실패 — HTML5 유지', { error: error?.message });
      } finally {
        hybridReviewSwapInFlight = false;
      }
    }
    hybridReviewResumeMpvFile = null;
  }

  async function fallbackFromMpvOverlayRecoveryFailure(owner, filePath, error) {
    if (!isCurrentMpvOverlayFallbackOwner(owner, filePath)) return false;
    if (isAppShuttingDown) return false;
    if (videoPlayer.engine === 'html5') return false;

    const resumeFrame = Number.isFinite(Number(videoPlayer.currentFrame))
      ? Number(videoPlayer.currentFrame)
      : null;
    const resumePlayback = videoPlayer.isPlaying === true;
    log.warn('mpv 오버레이 복구 실패, 기존 재생 방식으로 안전 전환', {
      filePath,
      error: error || 'unknown'
    });
    showToast('mpv 표시 화면을 복구하지 못해 기존 재생 방식으로 전환합니다.', 'warning');

    return loadVideoWithHtml5Fallback(filePath, {
      keepVersionContext: true,
      initialFrame: resumeFrame,
      playWhenMediaReady: resumePlayback
    }, { owner });
  }

  function fallbackFromMpvOverlayRecoveryFailureOnce(owner, filePath, error, { retryCount = 0 } = {}) {
    if (!mpvOverlayLifecycle.owns(owner) || mpvOverlayFallbackOwner === owner) return false;
    if (!isCurrentMpvOverlayFallbackOwner(owner, filePath)) {
      if (activeVideoLoadToken !== null) {
        mpvOverlayDeferredFallback = Object.freeze({ owner, filePath, error, retryCount });
      }
      return false;
    }

    if (mpvOverlayDeferredFallback?.owner === owner) {
      mpvOverlayDeferredFallback = null;
    }
    mpvOverlayFallbackOwner = owner;
    void fallbackFromMpvOverlayRecoveryFailure(owner, filePath, error).then((loaded) => {
      if (loaded === true) return;
      if (mpvOverlayFallbackOwner === owner) {
        mpvOverlayFallbackOwner = null;
      }
      if (
        retryCount >= 1 ||
        isAppShuttingDown ||
        videoPlayer.engine === 'html5' ||
        !mpvOverlayLifecycle.owns(owner)
      ) {
        return;
      }

      mpvOverlayDeferredFallback = Object.freeze({
        owner,
        filePath,
        error,
        retryCount: retryCount + 1
      });
      retryDeferredMpvOverlayFallback();
    }).catch((fallbackError) => {
      if (mpvOverlayFallbackOwner === owner) {
        mpvOverlayFallbackOwner = null;
      }
      log.warn('mpv 오버레이 HTML5 전환 실패', { error: fallbackError.message });
    });
    return true;
  }

  function retryDeferredMpvOverlayFallback() {
    if (activeVideoLoadToken !== null || !mpvOverlayDeferredFallback) return false;

    const deferredFallback = mpvOverlayDeferredFallback;
    mpvOverlayDeferredFallback = null;
    if (!mpvOverlayLifecycle.owns(deferredFallback.owner)) return false;

    return fallbackFromMpvOverlayRecoveryFailureOnce(
      deferredFallback.owner,
      deferredFallback.filePath,
      deferredFallback.error,
      { retryCount: deferredFallback.retryCount || 0 }
    );
  }

  function recoverMpvOverlayHostOnce(owner, error) {
    if (!mpvOverlayLifecycle.owns(owner)) return false;
    if (mpvOverlayRecoveryOwner === owner) {
      if (mpvOverlayRecoveryInFlightOwner !== owner) {
        fallbackFromMpvOverlayRecoveryFailureOnce(
          owner,
          videoPlayer.filePath || state.currentFile,
          error
        );
      }
      return false;
    }

    mpvOverlayRecoveryOwner = owner;
    mpvOverlayRecoveryInFlightOwner = owner;
    mpvOverlaySyncEpoch += 1;
    const recoveryFilePath = videoPlayer.filePath || state.currentFile;
    const recoveryPromise = mpvTeardownGate.run(async () => {
      if (!mpvOverlayLifecycle.owns(owner)) return { success: false, stale: true };

      try {
        const destroyResult = await window.electronAPI?.mpvDestroyOverlay?.();
        if (!mpvOverlayLifecycle.owns(owner)) return { success: false, stale: true };
        if (!destroyResult?.success) {
          throw new Error(destroyResult?.error || 'mpv overlay destroy failed');
        }

        const overlayHost = await prepareMpvOverlayHost();
        if (!mpvOverlayLifecycle.owns(owner)) return { success: false, stale: true };
        if (!overlayHost) {
          throw new Error('mpv overlay reprepare failed');
        }

        const recoveryState = getMpvOverlayState();
        if (!recoveryState) {
          throw new Error('mpv overlay recovery state unavailable');
        }
        const recoverySyncResult = await window.electronAPI?.mpvUpdateOverlayState?.(recoveryState);
        if (!mpvOverlayLifecycle.owns(owner)) return { success: false, stale: true };
        if (!recoverySyncResult?.success) {
          throw new Error(recoverySyncResult?.error || 'mpv overlay recovery sync failed');
        }
        if (!mpvOverlayLifecycle.markReady(owner)) return { success: false, stale: true };

        log.info('mpv 오버레이 호스트를 한 번 다시 준비했습니다.');
        scheduleMpvOverlayStateSync({ force: true });
        scheduleMpvOverlayRemoteCursorStateSync();
        return { success: true };
      } catch (recoveryError) {
        return {
          success: false,
          error: recoveryError.message || error || 'unknown'
        };
      }
    });

    void recoveryPromise.then(async (result) => {
      if (mpvOverlayRecoveryInFlightOwner === owner) {
        mpvOverlayRecoveryInFlightOwner = null;
      }
      if (result?.success || result?.stale || !mpvOverlayLifecycle.owns(owner)) return;
      fallbackFromMpvOverlayRecoveryFailureOnce(owner, recoveryFilePath, result?.error || error);
    }).catch((recoveryError) => {
      if (mpvOverlayRecoveryInFlightOwner === owner) {
        mpvOverlayRecoveryInFlightOwner = null;
      }
      log.warn('mpv 오버레이 복구 처리 실패', { error: recoveryError.message });
      fallbackFromMpvOverlayRecoveryFailureOnce(owner, recoveryFilePath, recoveryError.message);
    });
    return true;
  }

  function markMpvOverlayHostUnavailable(owner, error) {
    const markedUnavailable = mpvOverlayLifecycle.markUnavailable(owner, error);
    if (!markedUnavailable) return false;
    recoverMpvOverlayHostOnce(owner, error);
    return true;
  }

  const MPV_BLOCKING_OVERLAY_SELECTOR = [
    '.modal-overlay.active',
    '.thread-overlay.open',
    '.image-viewer-overlay.open',
    '.split-view-overlay.open',
    '.prompt-modal-overlay.open',
    '.credits-overlay.active',
    '.codec-error-overlay.active',
    '.app-saving-overlay.active',
    '#videoLoadingOverlay.active',
    '.transcode-overlay.active',
    '.composition-layer-context-menu',
    '.comment-marker-input-wrapper',
    '.composition-drop-choice-overlay',
    '.video-wrapper.mpv-review-freeze-ready',
    '.marker-popup',
    '.layer-settings-popup',
    '.highlight-popup',
    '.shortcuts-menu.visible',
    '.comment-settings-dropdown.open',
    '.filter-dropdown-menu.open',
    '.mention-dropdown',
    '.recent-dropdown-menu.open',
    '.version-dropdown.open .version-dropdown-menu',
    '.split-version-selector.open .split-version-menu'
  ].join(',');

  const MPV_MIRRORED_OVERLAY_SELECTOR = [
    '.comment-markers-container',
    '.comment-marker',
    '.comment-marker-tooltip',
    '.video-comment-range-overlay',
    '.current-cut-overlay',
    '.zoom-indicator-overlay',
    '.fullscreen-timecode-overlay',
    '.fullscreen-scrub-overlay',
    '.toast-container',
    '#compositionLayerOverlay',
    '.composition-layer-panel',
    '.video-zoom-controls',
    '.video-comment-overlay-controls',
    // 피드백 28(a): 반드시 전체화면+표시 중으로 한정할 것. 무조건 '.controls-bar'로
    // 넣으면 재생 중 매 프레임 갱신되는 진행률 바(#seekbarProgress)·타임코드 변이가
    // installMpvMirroredOverlayObserver(6198~)를 통해 모든 mpv 재생에서 프레임당
    // 전체 미러 재동기화(= 드로잉 합성 PNG 재인코딩 포함)를 유발한다.
    'body.app-fullscreen.show-controls .controls-bar'
  ].join(',');

  const MPV_HTML_OVERLAY_STYLE_PROPERTIES = [
    'align-items',
    'animation',
    'animation-delay',
    'animation-direction',
    'animation-duration',
    'animation-fill-mode',
    'animation-iteration-count',
    'animation-name',
    'animation-play-state',
    'animation-timing-function',
    'backdrop-filter',
    'background',
    'background-color',
    'border',
    'border-color',
    'border-radius',
    'border-style',
    'border-width',
    'bottom',
    'box-shadow',
    'box-sizing',
    'color',
    'display',
    'flex-direction',
    'font',
    'font-family',
    'font-size',
    'font-weight',
    'gap',
    'height',
    'justify-content',
    'left',
    'letter-spacing',
    'line-height',
    'margin',
    'max-height',
    'max-width',
    'min-height',
    'min-width',
    'opacity',
    'overflow',
    'padding',
    'pointer-events',
    'position',
    'right',
    'text-align',
    'text-overflow',
    'top',
    'transform',
    'transform-origin',
    'visibility',
    'white-space',
    'width',
    'z-index',
    '-webkit-backdrop-filter'
  ];

  function doesRectOverlapMpvHost(rect) {
    const hostRect = elements.videoWrapper?.getBoundingClientRect();
    if (!hostRect || hostRect.width <= 0 || hostRect.height <= 0) return false;
    return rect.right > hostRect.left &&
      rect.left < hostRect.right &&
      rect.bottom > hostRect.top &&
      rect.top < hostRect.bottom;
  }

  function isElementVisiblyBlockingMpv(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (!doesRectOverlapMpvHost(rect)) return false;
    return rect.width > 0 && rect.height > 0;
  }

  function hasBlockingOverlayForMpv() {
    return Array.from(document.querySelectorAll(MPV_BLOCKING_OVERLAY_SELECTOR))
      .some(isElementVisiblyBlockingMpv);
  }

  function didMpvHostVisibilityApply(result, shouldShowMpvHost) {
    if (!result?.success) return false;
    if (shouldShowMpvHost) return true;
    return result.embed?.ready === true && result.overlay?.ready === true;
  }

  function forceMpvHostVisibilitySync() {
    mpvHostLastRequestedVisible = null;
    syncMpvHostVisibilityWithDom();
  }

  function shouldShowMpvHostForCurrentState() {
    return !mpvPilotHostPreparing &&
      document.body.classList.contains('mpv-pilot-mode') &&
      mpvReviewFreezeHostHideOwner === null &&
      !hasBlockingOverlayForMpv();
  }

  async function resyncMpvHostVisibilityForCurrentState() {
    if (!window.electronAPI?.mpvSetHostVisible) return false;

    const shouldShowMpvHost = shouldShowMpvHostForCurrentState();
    mpvHostLastRequestedVisible = null;
    try {
      const result = await window.electronAPI.mpvSetHostVisible(shouldShowMpvHost);
      if (!didMpvHostVisibilityApply(result, shouldShowMpvHost)) return false;
      mpvHostLastRequestedVisible = shouldShowMpvHost;
      return true;
    } catch (error) {
      log.debug('mpv 호스트 현재 상태 재동기화 실패', { error: error.message });
      return false;
    }
  }

  function syncMpvHostVisibilityWithDom() {
    if (!mpvPilotHostPreparing && !document.body.classList.contains('mpv-pilot-mode')) return;
    if (!window.electronAPI?.mpvSetHostVisible) return;
    if (mpvHostVisibilitySyncPending) return;

    mpvHostVisibilitySyncPending = true;
    requestAnimationFrame(async () => {
      mpvHostVisibilitySyncPending = false;
      const shouldShowMpvHost = shouldShowMpvHostForCurrentState();
      if (mpvHostLastRequestedVisible === shouldShowMpvHost) return;

      try {
        const result = await window.electronAPI.mpvSetHostVisible(shouldShowMpvHost);
        if (didMpvHostVisibilityApply(result, shouldShowMpvHost)) {
          mpvHostLastRequestedVisible = shouldShowMpvHost;
        }
      } catch (error) {
        log.debug('mpv 호스트 표시 상태 동기화 실패', { error: error.message });
      }
    });
  }

  function installMpvBlockingOverlayObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!mpvPilotHostPreparing && !document.body.classList.contains('mpv-pilot-mode')) return;
      if (!mutations.some((mutation) => mutation.type === 'attributes' || mutation.type === 'childList')) return;
      syncMpvHostVisibilityWithDom();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
    syncMpvHostVisibilityWithDom();
  }

  installMpvBlockingOverlayObserver();

  function getMutationElementTarget(target) {
    if (!target) return null;
    if (target.nodeType === Node.ELEMENT_NODE) return target;
    return target.parentElement || null;
  }

  function isMpvMirroredOverlayMutation(mutation) {
    const target = getMutationElementTarget(mutation.target);
    if (target && target.matches?.(MPV_MIRRORED_OVERLAY_SELECTOR)) return true;
    if (target && target.closest?.(MPV_MIRRORED_OVERLAY_SELECTOR)) return true;

    return Array.from(mutation.addedNodes || []).some((node) => (
      node.nodeType === Node.ELEMENT_NODE &&
      (node.matches?.(MPV_MIRRORED_OVERLAY_SELECTOR) ||
        node.querySelector?.(MPV_MIRRORED_OVERLAY_SELECTOR))
    )) || Array.from(mutation.removedNodes || []).some((node) => (
      node.nodeType === Node.ELEMENT_NODE &&
      (node.matches?.(MPV_MIRRORED_OVERLAY_SELECTOR) ||
        node.querySelector?.(MPV_MIRRORED_OVERLAY_SELECTOR))
    ));
  }

  function installMpvMirroredOverlayObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!document.body.classList.contains('mpv-pilot-mode')) return;
      if (!mutations.some(isMpvMirroredOverlayMutation)) return;
      scheduleMpvOverlayStateSync({ force: true });
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
    });
  }

  installMpvMirroredOverlayObserver();

  async function waitForMpvPlaybackTime(targetTime, { timeoutMs = 700, tolerance = 0.12 } = {}) {
    if (!window.electronAPI?.mpvGetStatus) return false;
    const target = Number(targetTime);
    if (!Number.isFinite(target)) return false;

    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      try {
        const status = await window.electronAPI.mpvGetStatus();
        const current = Number(status?.time);
        if (status?.success && Number.isFinite(current) && Math.abs(current - target) <= tolerance) {
          return true;
        }
      } catch (error) {
        log.debug('mpv 초기 프레임 대기 실패', { error: error.message });
        return false;
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    return false;
  }

  async function seekMpvInitialFrameBeforeReveal(initialFrame) {
    const frame = Number(initialFrame);
    if (!Number.isFinite(frame) || frame <= 0 || !videoPlayer.isLoaded) return false;

    const fps = Math.max(1, Number(videoPlayer.fps) || 24);
    const targetTime = frame / fps;
    videoPlayer.seekToFrame(frame);
    return waitForMpvPlaybackTime(targetTime, {
      tolerance: Math.max(0.004, (1 / fps) * 0.45)
    });
  }

  function getMpvEmbedBounds() {
    syncMpvFullscreenViewportInset();

    const rect = elements.videoWrapper?.getBoundingClientRect();
    if (!rect || rect.width <= 1 || rect.height <= 1) return null;

    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      devicePixelRatio: window.devicePixelRatio || 1
    };
  }

  function getMpvFullscreenControlsInset() {
    if (!document.body.classList.contains('mpv-pilot-mode')) return 0;
    if (!document.body.classList.contains('app-fullscreen')) return 0;
    if (!document.body.classList.contains('show-controls')) return 0;

    const controlsRect = elements.controlsBar?.getBoundingClientRect();
    if (!controlsRect || controlsRect.height <= 0) return 0;

    // 피드백 28(b): 트랜지션 중간 위치(controlsRect.top)를 읽으면 wrapper가 0.3초 동안
    // 매 프레임 계단식으로 mpv 네이티브 창을 리사이즈해 비율이 깨져 보인다.
    // 높이·상대 돌출량은 translateY 트랜지션과 무관한 상수이므로, 표시 완료 시점의
    // 최종 인셋을 즉시 계산해 축소를 1회 스냅으로 만든다.
    const seekbarRect = elements.fullscreenSeekbar?.getBoundingClientRect();
    const seekbarProtrusion = seekbarRect && seekbarRect.height > 0
      ? Math.max(0, controlsRect.top - seekbarRect.top)
      : 0;
    const viewportBottom = Math.max(1, window.innerHeight || controlsRect.bottom);
    const inset = Math.max(0, Math.min(viewportBottom - 1, controlsRect.height + seekbarProtrusion));

    // 피드백 28(a): 영상 하단 검은 여백이 컨트롤바를 다 수용하면 화면을 줄이지
    // 않는다(인셋 0). 컨트롤바는 오버레이 미러로 여백 위에 표시된다. 여백은
    // ① 레터박스(영상비 vs 화면비 차이)와 ② 배율 축소(videoZoom < 100) 둘 다에서
    // 생기므로 줌 배율을 반영해 계산한다. 중앙 고정 상태(shouldCenterVideo)에서
    // 영상은 wrapper 중앙 기준 scale 배율로 표시된다(applyVideoZoom의
    // transform-origin: 'center center' + pan 0 리셋). 팬/확대 상태에서는 영상이
    // 여백을 침범할 수 있어 기존대로 축소한다.
    if (inset > 0 && shouldCenterVideo()) {
      const renderArea = getVideoRenderArea();
      const wrapperHeight = elements.videoWrapper?.clientHeight || 0;
      if (renderArea && wrapperHeight > 0) {
        const scale = Math.max(0.01, state.videoZoom / 100);
        const scaledBottom = wrapperHeight / 2 + (renderArea.height * scale) / 2;
        const bottomGap = Math.max(0, wrapperHeight - scaledBottom);
        if (bottomGap >= inset) return 0;
      }
    }
    return inset;
  }

  function syncMpvFullscreenViewportInset() {
    const inset = getMpvFullscreenControlsInset();
    elements.videoWrapper?.style.setProperty('--mpv-fullscreen-controls-inset', `${inset}px`);
  }

  function getMpvVideoTransform() {
    const rect = elements.videoWrapper?.getBoundingClientRect();
    if (!rect || rect.width <= 1 || rect.height <= 1) {
      return { zoom: 0, panX: 0, panY: 0 };
    }

    const renderArea = getVideoRenderArea();
    const panWidth = Math.max(1, Number(renderArea?.width) || rect.width);
    const panHeight = Math.max(1, Number(renderArea?.height) || rect.height);
    const scale = Math.max(0.01, state.videoZoom / 100);
    const zoom = Math.log2(scale);
    return {
      zoom,
      panX: state.videoPanX / panWidth,
      panY: state.videoPanY / panHeight
    };
  }

  async function prepareMpvEmbedHost() {
    if (!window.electronAPI?.mpvPrepareEmbed) return null;

    const bounds = getMpvEmbedBounds();
    if (!bounds) return null;

    const result = await window.electronAPI.mpvPrepareEmbed(bounds);
    if (result?.success && result.wid) {
      forceMpvHostVisibilitySync();
      return result;
    }

    log.warn('mpv 임베드 호스트 준비 실패, 외부 창 방식으로 폴백', {
      error: result?.error || 'unknown'
    });
    return null;
  }

  async function prepareMpvOverlayHost() {
    if (!window.electronAPI?.mpvPrepareOverlay) return null;

    const bounds = getMpvEmbedBounds();
    if (!bounds) return null;

    const result = await window.electronAPI.mpvPrepareOverlay(bounds);
    if (result?.success) {
      await fabricDrawingPilotInitialization;
      await fabricDrawingPilotController.adoptOverlayCapability(result.drawingCapability);
      forceMpvHostVisibilitySync();
      return result;
    }

    log.warn('mpv 오버레이 호스트 준비 실패', {
      error: result?.error || 'unknown'
    });
    return null;
  }

  async function syncMpvOverlayBounds(bounds = getMpvEmbedBounds()) {
    if (!document.body.classList.contains('mpv-pilot-mode')) return;
    if (!window.electronAPI?.mpvUpdateOverlayBounds) return;
    if (!bounds) return;

    try {
      await window.electronAPI.mpvUpdateOverlayBounds(bounds);
    } catch (error) {
      log.debug('mpv 오버레이 위치 갱신 실패', { error: error.message });
    }
  }

  function getCanvasOverlayDataUrl(canvas) {
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return '';
    try {
      return canvas.toDataURL('image/png');
    } catch (error) {
      log.debug('mpv 오버레이 캔버스 스냅샷 실패', { error: error.message });
      return '';
    }
  }

  // 피드백 32: 드로잉 미러 PNG 캐시 — paintStamp가 같으면 재인코딩하지 않는다.
  let mpvDrawingMirrorCache = { key: '', dataUrl: '' };

  function getCompositedDrawingOverlayDataUrl() {
    const baseCanvas = elements.drawingCanvas;
    if (!baseCanvas || baseCanvas.width <= 0 || baseCanvas.height <= 0) return '';

    const activeLayerOpacity = Number(drawingManager.getActiveLayer?.()?.opacity);
    const activeCanvasOpacity = Number.isFinite(activeLayerOpacity)
      ? Math.max(0, Math.min(1, activeLayerOpacity))
      : 1;

    // 스트로크·선택 조작 중에는 캔버스가 이벤트 없이 계속 변하므로 캐시를 쓰지 않는다.
    const canvasBusy = drawingManager.drawingCanvas?.isDrawing === true ||
      !!drawingManager.drawingCanvas?.floatingImage ||
      !!drawingManager.drawingCanvas?.selection;
    const cacheKey = canvasBusy
      ? ''
      : [
        drawingManager.paintStamp,
        drawingManager.activeLayerId,
        baseCanvas.width,
        baseCanvas.height,
        activeCanvasOpacity
      ].join('|');
    if (cacheKey && mpvDrawingMirrorCache.key === cacheKey) {
      return mpvDrawingMirrorCache.dataUrl;
    }

    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = baseCanvas.width;
    compositeCanvas.height = baseCanvas.height;
    const ctx = compositeCanvas.getContext('2d');
    const drawCanvas = (canvas, opacity = 1) => {
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
      ctx.globalAlpha = opacity;
      ctx.drawImage(canvas, 0, 0);
      ctx.globalAlpha = 1;
    };

    drawCanvas(elements.layersBelowCanvas);
    drawCanvas(baseCanvas, activeCanvasOpacity);
    drawCanvas(elements.selectionOverlayCanvas);
    drawCanvas(elements.layersAboveCanvas);

    try {
      const dataUrl = compositeCanvas.toDataURL('image/png');
      if (cacheKey) {
        mpvDrawingMirrorCache = { key: cacheKey, dataUrl };
      }
      return dataUrl;
    } catch (error) {
      log.debug('mpv 드로잉 합성 스냅샷 실패', { error: error.message });
      return '';
    }
  }

  function isMpvMarkerOverlayVisible() {
    if (!markerContainer) return false;
    const style = window.getComputedStyle(markerContainer);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0;
  }

  function serializeMpvOverlayMarkerHtml() {
    if (!markerContainer) return '';
    if (!isMpvMarkerOverlayVisible()) return '';

    const clone = markerContainer.cloneNode(true);
    const sourceTextareas = markerContainer.querySelectorAll('textarea');
    clone.querySelectorAll('textarea').forEach((textarea, index) => {
      const sourceTextarea = sourceTextareas[index];
      textarea.textContent = sourceTextarea.value;
      textarea.setAttribute('value', sourceTextarea.value);
    });
    clone.querySelectorAll('[id]').forEach((el) => {
      el.removeAttribute('id');
    });

    return clone.innerHTML;
  }

  function serializeMpvOverlayTooltipHtml() {
    if (!isMpvMarkerOverlayVisible()) return '';

    const wrapperRect = elements.videoWrapper?.getBoundingClientRect();
    if (!wrapperRect) return '';

    const tooltipLayer = document.createElement('div');
    document.querySelectorAll('.comment-marker-tooltip').forEach((tooltip) => {
      const tooltipRect = tooltip.getBoundingClientRect();
      const tooltipClone = tooltip.cloneNode(true);
      tooltipClone.style.position = 'absolute';
      tooltipClone.style.left = `${tooltipRect.left - wrapperRect.left}px`;
      tooltipClone.style.top = `${tooltipRect.top - wrapperRect.top}px`;
      tooltipClone.style.transform = 'none';
      tooltipClone.style.pointerEvents = 'none';
      tooltipLayer.appendChild(tooltipClone);
    });
    tooltipLayer.querySelectorAll('[id]').forEach((el) => {
      el.removeAttribute('id');
    });

    return tooltipLayer.innerHTML;
  }

  function copyComputedMpvOverlayStyles(source, target) {
    const computedStyle = window.getComputedStyle(source);
    MPV_HTML_OVERLAY_STYLE_PROPERTIES.forEach((property) => {
      const value = computedStyle.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    });
  }

  function cloneMpvHtmlOverlayElement(element, wrapperRect) {
    if (!element || !isElementVisiblyBlockingMpv(element)) return null;

    const rect = element.getBoundingClientRect();
    const clone = element.cloneNode(true);
    const sourceElements = [element, ...element.querySelectorAll('*')];
    const targetElements = [clone, ...clone.querySelectorAll('*')];

    sourceElements.forEach((sourceElement, index) => {
      const targetElement = targetElements[index];
      if (targetElement) copyComputedMpvOverlayStyles(sourceElement, targetElement);
    });

    // 32 잔존: 미러는 정지 스냅샷이다 — 복사된 animation이 재주입 때마다 0%부터 재생되는 것을 차단.
    targetElements.forEach((targetElement) => {
      if (targetElement) targetElement.style.animation = 'none';
    });

    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
    clone.style.position = 'absolute';
    clone.style.left = `${rect.left - wrapperRect.left}px`;
    clone.style.top = `${rect.top - wrapperRect.top}px`;
    clone.style.right = 'auto';
    clone.style.bottom = 'auto';
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.margin = '0';
    clone.style.pointerEvents = 'none';
    clone.style.transform = 'none';

    return clone;
  }

  function serializeMpvOverlayHtml() {
    const wrapperRect = elements.videoWrapper?.getBoundingClientRect();
    if (!wrapperRect) return '';

    const htmlOverlay = document.createElement('div');
    [
      elements.currentCutOverlay,
      elements.zoomIndicatorOverlay,
      videoCommentRangeOverlay,
      fullscreenTimecodeOverlay,
      fullscreenScrubOverlay,
      // 피드백 28(a): 전체화면 컨트롤바(자식인 전체화면 시크바 포함)를 mpv 위에 미러링.
      // 숨김(opacity 0)·wrapper 비겹침이면 cloneMpvHtmlOverlayElement가 스스로 스킵한다.
      elements.controlsBar,
      // 사용자 지시(2026-07-15): mpv에 가려지던 UI를 미러로 표시.
      // 클릭은 호스트 창 관통으로 실제 DOM에 도달하므로 보이기만 하면 조작된다.
      elements.compositionLayerPanel?.classList.contains('open') ? elements.compositionLayerPanel : null,
      elements.videoZoomControls,
      elements.videoCommentOverlayControls
    ].filter(Boolean).forEach((element) => {
      const clone = cloneMpvHtmlOverlayElement(element, wrapperRect);
      if (clone) htmlOverlay.appendChild(clone);
    });

    // 32 잔존(f): 재생 중 매 프레임 갱신되는 playhead의 인라인 left를 고정값으로 정규화한다.
    // 그래야 htmlOverlay 직렬화 문자열이 프레임마다 바뀌지 않아 diff가 실효하고, playhead는
    // 별도 필드(commentPlayheadLeft)로 호스트에서 스타일만 갱신된다.
    htmlOverlay.querySelectorAll('.video-comment-range-playhead').forEach((playhead) => {
      playhead.style.left = '0%';
    });

    return htmlOverlay.innerHTML;
  }

  function serializeMpvOverlayToastHtml() {
    const wrapperRect = elements.videoWrapper?.getBoundingClientRect();
    if (!wrapperRect || !elements.toastContainer) return '';

    const clone = cloneMpvHtmlOverlayElement(elements.toastContainer, wrapperRect);
    if (!clone) return '';

    clone.querySelectorAll('button').forEach((button) => {
      button.setAttribute('tabindex', '-1');
      button.style.pointerEvents = 'none';
    });
    clone.querySelectorAll('.toast-enter').forEach((toast) => {
      toast.classList.remove('toast-enter');
      toast.style.animation = 'none';
      toast.style.transform = '';
      toast.style.opacity = '';
    });

    return clone.outerHTML;
  }

  function serializeMpvOverlayRemoteCursorHtml() {
    if (!remoteCursorsContainer || !userSettings.getShowRemoteCursors()) return '';

    const clone = remoteCursorsContainer.cloneNode(true);
    clone.querySelectorAll('[id]').forEach((el) => {
      el.removeAttribute('id');
    });
    clone.querySelectorAll('.remote-cursor').forEach((cursor) => {
      cursor.style.pointerEvents = 'none';
    });

    return clone.innerHTML;
  }

  function getMpvOverlayState() {
    const wrapperRect = elements.videoWrapper?.getBoundingClientRect();
    const canvasRect = elements.drawingCanvas?.getBoundingClientRect();
    if (!wrapperRect || !canvasRect) return null;
    const suppressLegacyDrawing = shouldSuppressLegacyDrawingForFabricPilot();

    return {
      drawingDataUrl: suppressLegacyDrawing ? '' : getCompositedDrawingOverlayDataUrl(),
      // 피드백 32: 어니언 스킨이 꺼져 있으면 전체 해상도 투명 PNG 인코딩을 생략한다.
      onionDataUrl: !suppressLegacyDrawing && drawingManager.onionSkin?.enabled
        ? getCanvasOverlayDataUrl(elements.onionSkinCanvas)
        : '',
      fabricViewport: getFabricDrawingPilotViewport(),
      markerHtml: serializeMpvOverlayMarkerHtml(),
      tooltipHtml: serializeMpvOverlayTooltipHtml(),
      htmlOverlayHtml: serializeMpvOverlayHtml(),
      toastHtml: serializeMpvOverlayToastHtml(),
      remoteCursorHtml: serializeMpvOverlayRemoteCursorHtml(),
      compositionLayers: compositionLayerManager.getMpvOverlayLayers({
        currentTime: videoPlayer.currentTime,
        isPlaying: videoPlayer.isPlaying
      }),
      fabricPilotStatusText: fabricDrawingPilotController.isEnabled()
        ? fabricPilotStatusText
        : '',
      // 32 잔존(f): playhead 위치는 diff 대상이 아닌 별도 필드로 항상 전송(저비용) — 미러 재주입과 분리.
      commentPlayheadLeft: videoCommentPlayhead?.style.left || '',
      markerTransform: markerContainer?.style.transform || '',
      markerTransformOrigin: markerContainer?.style.transformOrigin || 'center center',
      videoTransform: getMpvVideoTransform(),
      canvas: {
        left: canvasRect.left - wrapperRect.left,
        top: canvasRect.top - wrapperRect.top,
        width: canvasRect.width,
        height: canvasRect.height
      }
    };
  }

  // 32 잔존: 미러 HTML/이미지 필드를 이전 전송값과 비교해, 변경 없으면 생략한다.
  // 생략된 필드는 JSON.stringify에서 사라지고, 호스트는 undefined 필드를 건너뛴다(부분 업데이트).
  // 호스트가 재생성되면 owner가 바뀌어 전체 재전송된다.
  const MPV_OVERLAY_DIFF_FIELDS = ['drawingDataUrl', 'onionDataUrl', 'markerHtml', 'tooltipHtml', 'htmlOverlayHtml', 'toastHtml'];
  MPV_OVERLAY_DIFF_FIELDS.push('fabricPilotStatusText');
  const mpvOverlayMirrorFieldCache = { owner: null, canvasKey: '', fields: {} };

  function formatFabricPilotStatusText(snapshot, diagnostics) {
    const overlay = diagnostics?.overlay;
    const attempted = Math.max(0, Math.trunc(Number(snapshot?.bInput?.attempted) || 0));
    const accepted = Math.max(0, Math.trunc(Number(snapshot?.bInput?.accepted) || 0));
    const localRevision = Math.max(0, Math.trunc(Number(snapshot?.inputRevision) || 0));
    const overlayRevision = Math.max(0, Math.trunc(Number(overlay?.inputRevision) || 0));
    const frame = Math.max(0, Math.trunc(Number(videoPlayer.currentFrame) || 0));
    const hostGeneration = Math.max(0, Math.trunc(Number(snapshot?.hostGeneration) || 0));
    const mpvOwner = isMpvPilotPlaybackActive() && videoPlayer.isPlaying ? 1 : 0;
    const htmlOwner = Array.from(document.querySelectorAll('audio, video'))
      .filter(media => media.paused === false && media.ended !== true)
      .length;
    const playbackOwnerCount = mpvOwner + htmlOwner;
    const saveAttempts = Math.max(0, Math.trunc(Number(overlay?.metrics?.saveAttemptCount) || 0));
    const surfaceErrors = Math.max(0, Math.trunc(Number(overlay?.metrics?.surfaceErrorCount) || 0));
    const errorCount = Math.max(
      surfaceErrors,
      snapshot?.lastError ? 1 : 0
    );
    const drawingState = String(snapshot?.state || 'unknown').toUpperCase();

    return `FABRIC TEST · DRAW ${drawingState} · B ${attempted}/${accepted} · ` +
      `rev ${localRevision}/${overlayRevision} · hostGen ${hostGeneration}\n` +
      `${videoPlayer.isPlaying ? 'PLAY' : 'PAUSE'} · F ${frame} · owner ${playbackOwnerCount} ` +
      `(mpv ${mpvOwner}/html ${htmlOwner}) · save ${saveAttempts} · err ${errorCount}`;
  }

  async function refreshFabricPilotStatus({ isCurrent }) {
    const snapshot = fabricDrawingPilotController.getStatusSnapshot();
    const diagnostics = await fabricDrawingPilotController.diagnostics();
    if (!isCurrent()) return;

    const nextStatusText = formatFabricPilotStatusText(snapshot, diagnostics);
    if (nextStatusText === fabricPilotStatusText) return;
    fabricPilotStatusText = nextStatusText;
    scheduleMpvOverlayStateSync({ force: true });
  }

  function scheduleFabricPilotStatusRefresh({ force = false } = {}) {
    if (!fabricDrawingPilotController.isEnabled()) {
      fabricPilotStatusRefreshCoordinator.cancel();
      if (fabricPilotStatusRefreshTimer) clearTimeout(fabricPilotStatusRefreshTimer);
      fabricPilotStatusRefreshTimer = null;
      fabricPilotStatusLastRefreshAt = 0;
      if (!fabricPilotStatusText) return;
      fabricPilotStatusText = '';
      scheduleMpvOverlayStateSync({ force: true });
      return;
    }

    const now = Date.now();
    const elapsed = now - fabricPilotStatusLastRefreshAt;
    if (force || elapsed >= FABRIC_PILOT_STATUS_SYNC_INTERVAL_MS) {
      if (fabricPilotStatusRefreshTimer) clearTimeout(fabricPilotStatusRefreshTimer);
      fabricPilotStatusRefreshTimer = null;
      fabricPilotStatusLastRefreshAt = now;
      fabricPilotStatusRefreshCoordinator.request();
      return;
    }
    if (fabricPilotStatusRefreshTimer) return;

    fabricPilotStatusRefreshTimer = setTimeout(() => {
      fabricPilotStatusRefreshTimer = null;
      fabricPilotStatusLastRefreshAt = Date.now();
      fabricPilotStatusRefreshCoordinator.request();
    }, FABRIC_PILOT_STATUS_SYNC_INTERVAL_MS - elapsed);
  }

  function filterUnchangedMpvOverlayFields(state, owner) {
    const canvasKey = `${state.canvas.left}|${state.canvas.top}|${state.canvas.width}|${state.canvas.height}`;
    const cacheValid = owner !== null && mpvOverlayMirrorFieldCache.owner === owner;
    const canvasChanged = !cacheValid || mpvOverlayMirrorFieldCache.canvasKey !== canvasKey;
    const next = { ...state };
    for (const field of MPV_OVERLAY_DIFF_FIELDS) {
      const value = state[field];
      // 이미지 필드는 canvas 사각형이 바뀌면 위치 재적용이 필요해 생략하지 않는다.
      const isImageField = field === 'drawingDataUrl' || field === 'onionDataUrl';
      if (cacheValid && !(isImageField && canvasChanged) && mpvOverlayMirrorFieldCache.fields[field] === value) {
        delete next[field];
      } else {
        mpvOverlayMirrorFieldCache.fields[field] = value;
      }
    }
    mpvOverlayMirrorFieldCache.owner = owner;
    mpvOverlayMirrorFieldCache.canvasKey = canvasKey;
    return next;
  }

  async function syncMpvOverlayState() {
    if (!document.body.classList.contains('mpv-pilot-mode')) return;
    if (!window.electronAPI?.mpvUpdateOverlayState) return;
    const overlayOwner = mpvOverlayLifecycle.captureReadyOwner();
    if (!overlayOwner) return;
    const overlaySyncEpoch = mpvOverlaySyncEpoch;
    if (mpvOverlayStateSyncPendingOwner === overlayOwner) return;

    mpvOverlayStateSyncPendingOwner = overlayOwner;
    requestAnimationFrame(async () => {
      if (mpvOverlayStateSyncPendingOwner === overlayOwner) {
        mpvOverlayStateSyncPendingOwner = null;
      }
      if (!mpvOverlayLifecycle.isReady(overlayOwner)) return;
      const state = getMpvOverlayState();
      if (!state) return;
      if (!mpvOverlayLifecycle.isReady(overlayOwner)) return;

      try {
        const result = await window.electronAPI.mpvUpdateOverlayState(filterUnchangedMpvOverlayFields(state, overlayOwner));
        if (!result?.success) {
          if (!mpvOverlayLifecycle.owns(overlayOwner) || overlaySyncEpoch !== mpvOverlaySyncEpoch) return;
          markMpvOverlayHostUnavailable(overlayOwner, result?.error);
        }
      } catch (error) {
        if (!mpvOverlayLifecycle.owns(overlayOwner) || overlaySyncEpoch !== mpvOverlaySyncEpoch) return;
        markMpvOverlayHostUnavailable(overlayOwner, error.message);
      }
    });
  }

  function syncMpvOverlayRemoteCursorState() {
    if (!document.body.classList.contains('mpv-pilot-mode')) return;
    if (!window.electronAPI?.mpvUpdateOverlayRemoteCursors) return;
    const overlayOwner = mpvOverlayLifecycle.captureReadyOwner();
    if (!overlayOwner) return;
    const overlaySyncEpoch = mpvOverlaySyncEpoch;
    if (mpvOverlayRemoteCursorSyncPendingOwner === overlayOwner) return;

    mpvOverlayRemoteCursorSyncPendingOwner = overlayOwner;
    requestAnimationFrame(async () => {
      if (mpvOverlayRemoteCursorSyncPendingOwner === overlayOwner) {
        mpvOverlayRemoteCursorSyncPendingOwner = null;
      }
      if (!mpvOverlayLifecycle.isReady(overlayOwner)) return;
      const remoteCursorHtml = serializeMpvOverlayRemoteCursorHtml();
      if (!mpvOverlayLifecycle.isReady(overlayOwner)) return;

      try {
        const result = await window.electronAPI.mpvUpdateOverlayRemoteCursors(remoteCursorHtml);
        if (!result?.success) {
          if (!mpvOverlayLifecycle.owns(overlayOwner) || overlaySyncEpoch !== mpvOverlaySyncEpoch) return;
          markMpvOverlayHostUnavailable(overlayOwner, result?.error);
        }
      } catch (error) {
        if (!mpvOverlayLifecycle.owns(overlayOwner) || overlaySyncEpoch !== mpvOverlaySyncEpoch) return;
        markMpvOverlayHostUnavailable(overlayOwner, error.message);
      }
    });
  }

  function scheduleMpvOverlayRemoteCursorStateSync() {
    syncMpvOverlayRemoteCursorState();
  }

  function scheduleMpvOverlayStateSync(options = {}) {
    if (options.force === true) {
      if (mpvOverlayStateSyncTimer) {
        clearTimeout(mpvOverlayStateSyncTimer);
        mpvOverlayStateSyncTimer = null;
      }
      mpvOverlayLastLiveDrawSyncAt = Date.now();
      syncMpvOverlayState();
      return;
    }

    if (options.liveDrawing === true) {
      const now = Date.now();
      const elapsed = now - mpvOverlayLastLiveDrawSyncAt;
      if (elapsed < MPV_OVERLAY_LIVE_DRAW_SYNC_INTERVAL_MS) {
        if (mpvOverlayStateSyncTimer) return;

        mpvOverlayStateSyncTimer = setTimeout(() => {
          mpvOverlayStateSyncTimer = null;
          mpvOverlayLastLiveDrawSyncAt = Date.now();
          syncMpvOverlayState();
        }, MPV_OVERLAY_LIVE_DRAW_SYNC_INTERVAL_MS - elapsed);
        return;
      }

      mpvOverlayLastLiveDrawSyncAt = now;
    }

    syncMpvOverlayState();
  }

  function syncMpvVideoTransform() {
    if (!document.body.classList.contains('mpv-pilot-mode')) return;
    if (!window.electronAPI?.mpvSetVideoTransform) return;
    if (mpvVideoTransformSyncPending) return;

    mpvVideoTransformSyncPending = true;
    requestAnimationFrame(async () => {
      mpvVideoTransformSyncPending = false;
      const transform = getMpvVideoTransform();

      try {
        await window.electronAPI.mpvSetVideoTransform(transform);
      } catch (error) {
        log.debug('mpv 화면 변환 동기화 실패', { error: error.message });
      }
    });
  }

  async function syncMpvEmbedBounds() {
    if (!document.body.classList.contains('mpv-pilot-mode')) return;
    if (!window.electronAPI?.mpvUpdateEmbedBounds) return;
    if (mpvEmbedBoundsSyncPending) return;

    mpvEmbedBoundsSyncPending = true;
    requestAnimationFrame(async () => {
      mpvEmbedBoundsSyncPending = false;
      const bounds = getMpvEmbedBounds();
      if (!bounds) return;

      try {
        await window.electronAPI.mpvUpdateEmbedBounds(bounds);
        await syncMpvOverlayBounds(bounds);
        scheduleMpvOverlayStateSync();
      } catch (error) {
        log.debug('mpv 임베드 위치 갱신 실패', { error: error.message });
      }
    });
  }

  function scheduleMpvEmbedBoundsSyncAfterLayout() {
    syncMpvEmbedBounds();

    requestAnimationFrame(() => {
      syncMpvEmbedBounds();

      requestAnimationFrame(() => {
        syncMpvEmbedBounds();
      });
    });

    setTimeout(() => {
      syncMpvEmbedBounds();
    }, 250);
  }

  async function destroyMpvPilotHosts() {
    try {
      await window.electronAPI?.mpvDestroyOverlay?.();
    } finally {
      await window.electronAPI?.mpvDestroyEmbed?.();
    }
  }

  async function stopMpvPilotEngine(overlayOwner = null) {
    return mpvPilotOwnershipGate.runOwnedTeardown(overlayOwner, async () => {
      try {
        await releaseMpvReviewFreezeFrame();
        return await window.electronAPI.mpvStop();
      } finally {
        mpvHostLastRequestedVisible = null;
        try {
          await destroyMpvPilotHosts();
        } finally {
          forceRemoveMpvReviewFreezeFrame();
        }
      }
    });
  }

  async function shouldUseMpvPilot(filePath, { fileIsAudio, hasPreparedVideoPath } = {}) {
    if (!filePath || fileIsAudio || hasPreparedVideoPath) return false;
    if (!window.electronAPI?.mpvIsEnabled || !window.electronAPI?.mpvIsAvailable) return false;

    try {
      const locallyEnabled = userSettings.getMpvPlaybackEnabled();
      const envEnabled = await window.electronAPI.mpvIsEnabled();
      if (!locallyEnabled && !envEnabled) return false;

      const available = await window.electronAPI.mpvIsAvailable();
      if (!available) {
        log.warn('mpv 파일럿이 켜져 있지만 mpv 실행 파일을 찾지 못했습니다.');
        return false;
      }

      return true;
    } catch (error) {
      log.warn('mpv 파일럿 사용 가능 여부 확인 실패', { error: error.message });
      return false;
    }
  }

  /**
   * HTML5 <video> 경로용 실제 fps 조회.
   * 우선순위: ffprobe(frameRate) -> mpv 헤드리스 프로브(container-fps) -> 24.
   * HTML5 video API는 fps를 제공하지 않으므로 로드 전에 반드시 외부 프로브가 필요하다.
   */
  async function resolveHtml5PlaybackFps(filePath) {
    if (!filePath) return 24;
    try {
      if (await window.electronAPI.ffmpegIsAvailable()) {
        const probe = await window.electronAPI.ffmpegProbeCodec(filePath);
        const probedFps = Number(probe?.frameRate);
        if (probe?.success && Number.isFinite(probedFps) && probedFps > 0) {
          return probedFps;
        }
      }
    } catch (error) {
      log.warn('ffprobe fps 조회 실패', { error: error.message });
    }
    try {
      if (window.electronAPI?.mpvIsAvailable && await window.electronAPI.mpvIsAvailable()) {
        const mpvProbe = await window.electronAPI.mpvProbeMetadata(filePath);
        const mpvFps = Number(mpvProbe?.fps);
        if (mpvProbe?.success && Number.isFinite(mpvFps) && mpvFps > 0) {
          return mpvFps;
        }
      }
    } catch (error) {
      log.warn('mpv 프로브 fps 조회 실패', { error: error.message });
    }
    return 24;
  }

  async function loadVideoWithMpvPilot(filePath, {
    initialFrame = null,
    initialTime = null,
    loadToken = null,
    isStaleVideoLoad = () => false
  } = {}) {
    const overlayOwner = await mpvPilotOwnershipGate.claim(loadToken, { isStaleVideoLoad });
    if (!overlayOwner) return false;
    clearExpectedMpvHtml5FallbackStop();
    let embedHost = null;
    let overlayHost = null;
    const ownsMpvPilotLoad = () => activeMpvPilotLoadToken === loadToken;
    const ownsMpvOverlayLifecycle = () => (
      ownsMpvPilotLoad() && mpvOverlayLifecycle.owns(overlayOwner)
    );
    const isStaleMpvPilotLifecycle = () => (
      isStaleVideoLoad() || !ownsMpvOverlayLifecycle()
    );
    const clearMpvPilotLoadOwner = () => {
      if (ownsMpvPilotLoad()) {
        activeMpvPilotLoadToken = null;
      }
    };
    const cleanupPendingMpvPilot = async () => {
      if (!ownsMpvOverlayLifecycle()) {
        log.debug('mpv 파일럿 준비 정리 건너뜀: 더 최신 mpv 영상 로드가 활성화됨', { filePath });
        return;
      }

      try {
        // mpv는 전역 공유 프로세스다. 새 owner가 자신의 mpvLoad 전에 실패해도
        // claim 이전 owner의 프로세스가 남아 있을 수 있으므로 항상 중단한다.
        await stopMpvPilotEngine(overlayOwner);
      } catch (error) {
        log.debug('mpv 파일럿 준비 정리 실패', { error: error.message });
      } finally {
        if (ownsMpvPilotLoad()) {
          mpvPilotHostPreparing = false;
          clearMpvPilotLoadOwner();
        }
      }
    };

    try {
      mpvPilotHostPreparing = true;
      embedHost = await prepareMpvEmbedHost();
      if (isStaleMpvPilotLifecycle()) {
        await cleanupPendingMpvPilot();
        return false;
      }
      overlayHost = await prepareMpvOverlayHost();
      if (isStaleMpvPilotLifecycle()) {
        await cleanupPendingMpvPilot();
        return false;
      }
      if (!overlayHost) {
        throw new Error('mpv 오버레이 호스트 준비 실패');
      }
      if (!mpvOverlayLifecycle.markReady(overlayOwner)) {
        await cleanupPendingMpvPilot();
        return false;
      }
      scheduleFabricPilotStatusRefresh({ force: true });
    } catch (error) {
      await cleanupPendingMpvPilot();
      throw error;
    }

    const stopCurrentMpvPilotEngine = async () => {
      try {
        return await stopMpvPilotEngine(overlayOwner);
      } finally {
        clearMpvPilotLoadOwner();
      }
    };

    if (isStaleMpvPilotLifecycle()) {
      await cleanupPendingMpvPilot();
      return false;
    }

    let loadResult = null;
    try {
      loadResult = await window.electronAPI.mpvLoad(filePath, {
        pause: true,
        wid: embedHost?.wid,
        videoTransform: getMpvVideoTransform()
      });
    } catch (error) {
      await cleanupPendingMpvPilot();
      throw error;
    }

    if (isStaleMpvPilotLifecycle()) {
      await cleanupPendingMpvPilot();
      return false;
    }
    if (!loadResult?.success) {
      await cleanupPendingMpvPilot();
      throw new Error(loadResult?.error || 'mpv 파일럿 로드 실패');
    }

    const metadata = {
      duration: Number(loadResult.duration) || 0,
      fps: Number(loadResult.fps) || 24,
      width: Number(loadResult.width) || 0,
      height: Number(loadResult.height) || 0
    };

    if (isStaleMpvPilotLifecycle()) {
      await cleanupPendingMpvPilot();
      return false;
    }

    videoPlayer.useExternalEngine({
      engineName: embedHost?.wid ? 'mpv-embedded' : 'mpv',
      filePath,
      duration: metadata.duration,
      fps: metadata.fps,
      width: metadata.width,
      height: metadata.height,
      paused: true,
      controls: {
        play: () => window.electronAPI.mpvPlay(),
        pause: () => window.electronAPI.mpvPause(),
        seek: (time) => window.electronAPI.mpvSeek(time),
        setVolume: (volume) => window.electronAPI.mpvSetVolume(volume),
        setMuted: (muted) => window.electronAPI.mpvSetMuted(muted),
        getStatus: () => window.electronAPI.mpvGetStatus(),
        stop: () => stopCurrentMpvPilotEngine()
      }
    });
    videoPlayer.setVolume(videoPlayer.videoElement.volume);
    videoPlayer.setMuted(videoPlayer.videoElement.muted);

    elements.videoWrapper?.classList.add('mpv-pilot-mode');
    document.body.classList.add('mpv-pilot-mode');
    syncCanvasOverlay();
    syncMpvEmbedBounds();
    syncMpvVideoTransform();
    scheduleMpvOverlayStateSync();

    const mpvInitialFrame = resolveInitialFrameFromOptions(initialFrame, initialTime);
    if (Number.isFinite(Number(mpvInitialFrame)) && Number(mpvInitialFrame) > 0) {
      const initialSeekReady = await seekMpvInitialFrameBeforeReveal(mpvInitialFrame);
      if (!initialSeekReady) {
        log.debug('mpv 초기 프레임 확인 시간 초과, 호스트 공개 전 한 프레임 더 대기', { filePath, initialFrame: mpvInitialFrame });
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }

    if (isStaleMpvPilotLifecycle()) {
      await cleanupPendingMpvPilot();
      return false;
    }

    mpvPilotHostPreparing = false;
    syncMpvHostVisibilityWithDom();
    if (isMpvReviewInteractionActive()) {
      videoPlayer.pause();
      let reviewReady = false;
      if (state.isDrawMode) {
        const preparationToken = ++drawModePreparationToken;
        reviewReady = await prepareMpvDrawMode(preparationToken);
      } else if (state.isCommentMode) {
        const preparationToken = ++commentModePreparationToken;
        reviewReady = await prepareMpvCommentMode(preparationToken);
      }
      if (isStaleMpvPilotLifecycle()) {
        await cleanupPendingMpvPilot();
        return false;
      }
      if (!reviewReady) {
        await cleanupPendingMpvPilot();
        throw new Error('mpv 리뷰 화면을 새 영상 프레임으로 준비하지 못했습니다.');
      }
    }

    return true;
  }

  async function resolveMpvThumbnailVideoPath(filePath, {
    isStaleVideoLoad = () => false
  } = {}) {
    if (isStaleVideoLoad()) return null;
    log.debug('mpv 파일럿 썸네일 생성 건너뜀: FFmpeg 없이 원본을 직접 재생합니다.', { filePath });
    return null;
  }

  // 피드백 36: 버전 전환 등에서 초 단위 위치를 유지한다. fps는 엔진 로드 후 확정되므로
  // initialFrame이 명시되지 않은 경우에만 호출 시점의 fps로 프레임을 계산한다.
  function resolveInitialFrameFromOptions(initialFrame, initialTime) {
    if (Number.isFinite(Number(initialFrame)) && Number(initialFrame) > 0) {
      return Number(initialFrame);
    }
    if (Number.isFinite(Number(initialTime)) && Number(initialTime) > 0 && Number(videoPlayer.fps) > 0) {
      const frame = Math.round(Number(initialTime) * Number(videoPlayer.fps));
      const maxFrame = Number.isFinite(Number(videoPlayer.totalFrames)) && Number(videoPlayer.totalFrames) > 0
        ? Number(videoPlayer.totalFrames) - 1
        : frame;
      return Math.max(0, Math.min(frame, maxFrame));
    }
    return null;
  }

  async function loadVideo(filePath, options = {}) {
    const {
      keepVersionContext = false,
      targetVersion = null,
      preserveContinuousSession = false,
      playWhenMediaReady = false,
      initialFrame = null,
      initialTime = null,
      revealAfterInitialSeek = false,
      holdPreviousFrameUntilReady = false,
      deferCollaborationStart = false,
      preparedVideoPath = null,
      allowMpvPilot = true,
      engineSwap = false,
      shouldContinue = null
    } = options;
    const shouldContinueVideoLoad = typeof shouldContinue === 'function'
      ? shouldContinue
      : () => true;
    const loadToken = ++latestVideoLoadToken;
    const isStaleVideoLoad = () => loadToken !== latestVideoLoadToken;
    let allowNavigationGuardAbort = true;
    const canContinueVideoLoad = () => (
      !isStaleVideoLoad() &&
      (!allowNavigationGuardAbort || shouldContinueVideoLoad())
    );
    if (!canContinueVideoLoad()) return false;
    if (!engineSwap) {
      await fabricDrawingPilotInitialization;
      if (!canContinueVideoLoad()) return false;
    }
    activeVideoLoadToken = loadToken;
    activeVideoLoadPath = filePath;
    if (!engineSwap) {
      await fabricDrawingPilotController.beforeVideoChange(loadToken);
      if (!canContinueVideoLoad()) {
        await fabricDrawingPilotController.cancelVideoChange(loadToken);
        if (activeVideoLoadToken === loadToken) {
          activeVideoLoadToken = null;
          activeVideoLoadPath = null;
        }
        return false;
      }
    }
    mpvDrawPlaybackTransitionToken += 1;
    elements.drawingTools?.classList.remove('playback-hidden');
    let videoLoadCompleted = false;
    supersedeActiveTranscodeOverlay('새 영상 선택');
    // 작업 4: engineSwap(같은 파일 엔진 전환)에서는 연속 재생 세션을 끊지 않는다.
    if (!engineSwap) {
      if (!preserveContinuousSession && continuousPlaybackState.active) {
        stopContinuousPlayback();
      }
    }

    const driveLoadingFeedbackShown = showDriveVideoLoadingFeedback(filePath, { preparedVideoPath });
    // 작업 4: engineSwap에서는 G:드라이브 로딩 오버레이 플래시를 억제한다(호출 리터럴은 테스트가 단언).
    if (engineSwap && driveLoadingFeedbackShown) {
      hideVideoLoadingOverlay('drive');
    }
    const trace = log.trace('loadVideo');
    try {
      // 파일 정보 가져오기
      const fileInfo = await window.electronAPI.getFileInfo(filePath);
      if (!canContinueVideoLoad()) return false;

      // ====== 오디오 파일 감지 ======
      const fileIsAudio = isAudioFile(fileInfo.name);

      // ====== 코덱 확인 및 트랜스코딩 (비디오만) ======
      const hasPreparedVideoPath = typeof preparedVideoPath === 'string' && preparedVideoPath.length > 0;
      const preparedVideoPathIsOriginal = hasPreparedVideoPath && isSameFilePath(preparedVideoPath, filePath);
      const hasConvertedPreparedVideoPath = hasPreparedVideoPath && !preparedVideoPathIsOriginal;
      let actualVideoPath = hasPreparedVideoPath ? preparedVideoPath : filePath;
      let thumbnailVideoPath = actualVideoPath;
      const useMpvPilot = allowMpvPilot && await shouldUseMpvPilot(filePath, { fileIsAudio, hasPreparedVideoPath: hasConvertedPreparedVideoPath });
      if (!canContinueVideoLoad()) return false;
      if (useMpvPilot) {
        await cancelPlaylistBackgroundTranscodesForMpvPilot('mpv 직접 재생 시작');
        if (!canContinueVideoLoad()) return false;
      }
      if (hasPreparedVideoPath) {
        log.debug('준비된 연속 재생 미디어 경로 사용', { filePath, preparedVideoPath });
      }
      let html5ProbedFps = null;
      const ffmpegAvailable = !useMpvPilot && !hasPreparedVideoPath && !fileIsAudio && await window.electronAPI.ffmpegIsAvailable();

      if (ffmpegAvailable) {
        const codecInfo = await window.electronAPI.ffmpegProbeCodec(filePath);
        if (!canContinueVideoLoad()) return false;

        const probedFrameRate = Number(codecInfo?.frameRate);
        if (codecInfo?.success && Number.isFinite(probedFrameRate) && probedFrameRate > 0) {
          html5ProbedFps = probedFrameRate;
        }

        if (codecInfo.success && !codecInfo.isSupported) {
          log.info('미지원 코덱 감지, 트랜스코딩 필요', { codec: codecInfo.codecName });

          // 캐시 확인
          const cacheResult = await window.electronAPI.ffmpegCheckCache(filePath);
          if (!canContinueVideoLoad()) return false;
          if (cacheResult.valid) {
            log.info('캐시된 변환 파일 사용', { path: cacheResult.convertedPath });
            actualVideoPath = cacheResult.convertedPath;
          } else {
            // 트랜스코딩 필요 - UI 표시
            const transcoded = await showTranscodeOverlay(filePath, codecInfo.codecName);
            if (!canContinueVideoLoad()) return false;
            if (transcoded.stale) return false;
            if (transcoded.success) {
              actualVideoPath = transcoded.outputPath;
            } else {
              // 트랜스코딩 실패 또는 취소
              log.warn('트랜스코딩 실패 또는 취소', { error: transcoded.error });
              showToast(`코덱 변환 실패: ${transcoded.error || '취소됨'}`, 'error');
              return false;
            }
          }
        }
      } else {
        log.debug('FFmpeg 사용 불가, 코덱 변환 건너뜀');
      }
      thumbnailVideoPath = actualVideoPath;

      // 작업 4: engineSwap(같은 파일 엔진 전환)에서는 저장·초기화·협업stop·undo초기화 등
      // 파괴 구간 전체를 건너뛴다 — B/C 모드 토글마다 상태가 날아가는 것을 막는 핵심.
      if (!engineSwap) {
      // 다른 파일을 여는 일반 로드가 시작되면 하이브리드 복귀 대상을 정리한다(경합 방지).
        hybridReviewResumeMpvFile = null;
        // ====== 이전 데이터 저장 (clear 전에 수행!) ======
        // 저장되지 않은 변경사항이 있으면 먼저 저장
        if (reviewDataManager.hasUnsavedChanges()) {
          log.info('파일 전환 전 변경사항 저장 시도');
          const saved = await reviewDataManager.save();
          if (!canContinueVideoLoad()) return false;
          if (!saved) {
          // 저장 실패 시 사용자에게 확인
            const proceed = confirm('현재 파일 저장에 실패했습니다. 저장하지 않고 전환할까요?');
            if (!proceed) {
              log.info('사용자가 파일 전환 취소');
              return false;
            }
            log.warn('저장 실패했지만 사용자가 전환 진행 선택');
          }
        }

        allowNavigationGuardAbort = false;

        // ====== 이전 파일 감시 및 협업 세션 정리 (누적 방지) ======
        void stopDeferredReviewFileDiscovery();
        if (reviewDataManager.currentBframePath) {
          await window.electronAPI.watchFileStop(reviewDataManager.currentBframePath);
          if (!canContinueVideoLoad()) return false;
          log.info('이전 파일 감시 중지', { path: reviewDataManager.currentBframePath });
          try {
            await liveblocksManager.stop();
          } catch (e) {
            log.warn('Liveblocks 세션 종료 중 오류', { error: e.message });
          } finally {
            commentSync.stop();
            drawingSync.stop();
          }
          // 협업 UI 초기화 (이전 세션의 아바타/인원 표시 제거)
          updateCollaboratorsUI([]);
          // 원격 커서 및 재생헤드 제거
          document.querySelectorAll('.remote-cursor').forEach(el => el.remove());
          document.querySelectorAll('.remote-playhead').forEach(el => el.remove());
          log.info('이전 협업 세션 종료');
        }

        // ====== 이전 데이터 초기화 ======
        // 자동 저장 일시 중지 (초기화 중 빈 데이터가 저장되는 것 방지)
        if (!canContinueVideoLoad()) return false;
        if (!beginDestructiveMpvReviewMediaChange(loadToken)) return false;
        reviewDataManager.pauseAutoSave();

        // 댓글 모드를 이벤트 경로로 먼저 종료한 뒤, DOM 준비 상태도 무조건 초기화한다.
        // clear()는 commentModeChanged를 발생시키지 않으므로 이 순서가 중요하다.
        const shouldKeepMpvReviewFreeze = isMpvPilotPlaybackActive() &&
        state.isDrawMode &&
        useMpvPilot &&
        !fileIsAudio &&
        preserveMpvReviewFreezeFrameForMediaChange();
        suppressReviewFreezeReleaseForMediaChange = true;
        try {
          commentManager.setCommentMode(false);
          state.isCommentMode = false;
          setCommentModeReadyState(false);
          setCommentModePreparingState(false);
          if (isMpvPilotPlaybackActive() && !shouldKeepMpvReviewFreeze) {
            await releaseMpvReviewFreezeFrame();
            if (!canContinueVideoLoad()) return false;
          }
        } finally {
          suppressReviewFreezeReleaseForMediaChange = false;
        }
        commentManager.clear();
        // 피드백 36: 버전 전환·파일 로드 시 이전 버전 댓글 고스트 자동 해제
        previousVersionComments = null;
        // 댓글 필터 상태 초기화
        resetCommentFilters();
        // Undo/Redo 스택 초기화 (파일 전환 시 크로스파일 오염 방지)
        undoStack.length = 0;
        redoStack.length = 0;
        // 그리기 매니저 초기화
        drawingManager.reset();
        // 하이라이트 매니저 초기화
        highlightManager.reset();
        // 타임라인 마커 초기화
        timeline.clearMarkers();
        // 영상 위 마커 UI 초기화
        markerContainer.innerHTML = '';
        // 코덱 에러 오버레이 숨기기
        codecErrorOverlay?.classList.remove('active');
      } // end if (!engineSwap) — 파괴 구간

      // ====== 오디오/비디오 모드 분기 ======
      const audioWaveform = getAudioWaveform();

      if (fileIsAudio) {
        elements.videoWrapper?.classList.remove('mpv-pilot-mode');
        document.body.classList.remove('mpv-pilot-mode');

        // 오디오 모드 활성화
        state.isAudioMode = true;
        videoPlayer.isAudioMode = true;
        log.info('오디오 모드 활성화', { filePath });

        // 비디오 엘리먼트 숨기기 (오디오에서는 불필요)
        elements.videoPlayer.style.display = 'none';

        // 오디오를 <video> 엘리먼트로 재생 (HTML5 video는 audio도 재생 가능)
        try {
          await videoPlayer.load(actualVideoPath);
          if (!canContinueVideoLoad()) return false;
        } catch (loadErr) {
          log.warn('videoPlayer.load 실패, 직접 src 설정으로 폴백', { error: loadErr.message });
          // 폴백: 직접 src 설정 (loadedmetadata 이벤트 없이)
          const videoUrl = actualVideoPath.startsWith('file://') ? actualVideoPath : `file://${actualVideoPath}`;
          elements.videoPlayer.src = videoUrl;
          // 로드 대기 (canplay 이벤트 또는 3초 타임아웃)
          await new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
              elements.videoPlayer.removeEventListener('canplay', onReady);
              elements.videoPlayer.removeEventListener('error', onError);
            };
            const onReady = () => {
              if (settled) return;
              settled = true;
              cleanup();
              resolve();
            };
            const onError = (e) => {
              if (settled) return;
              settled = true;
              cleanup();
              reject(new Error(`미디어 로드 실패: ${e.target?.error?.message || '알 수 없는 오류'}`));
            };
            elements.videoPlayer.addEventListener('canplay', onReady);
            elements.videoPlayer.addEventListener('error', onError);
            // 3초 타임아웃: canplay 없으면 실패 처리
            setTimeout(() => {
              if (settled) return;
              settled = true;
              cleanup();
              reject(new Error('미디어 로드 타임아웃 (3초)'));
            }, 3000);
          });
          if (!canContinueVideoLoad()) return false;
        }

        // videoPlayer.load()가 display:block을 강제할 수 있으므로 다시 숨김
        elements.videoPlayer.style.display = 'none';

        // 웨이브폼 마운트 및 로드
        if (!audioWaveform.canvas) {
          audioWaveform.mount(elements.audioWaveformContainer);
        }
        // 컨테이너를 먼저 표시해야 캔버스 크기가 확보됨
        audioWaveform.show();

        // 리사이즈가 안정적으로 반영될 때까지 한 프레임 대기
        await new Promise(resolve => requestAnimationFrame(resolve));

        try {
          await audioWaveform.loadAudio(filePath);
          if (!canContinueVideoLoad()) return false;
        } catch (err) {
          log.error('웨이브폼 로드 실패', { error: err.message, stack: err.stack });
          showToast(`웨이브폼 로드 실패: ${err.message}`, 'error');
        }

        // 웨이브폼 스크러빙 → videoPlayer seek 연동 (이전 핸들러 제거하여 중복 방지)
        if (audioWaveform._seekHandler) {
          audioWaveform.removeEventListener('seek', audioWaveform._seekHandler);
        }
        audioWaveform._seekHandler = (e) => {
          videoPlayer.seek(e.detail.time);
          playbackSync.broadcastSeek(e.detail.time);
        };
        audioWaveform.addEventListener('seek', audioWaveform._seekHandler);

        // 그리기 모드 비활성화 (오디오에서는 의미 없음)
        if (state.isDrawMode || isFabricDrawingPilotControllerEngaged()) {
          exitDrawModeForSystemPath();
          drawingManager.disable();
        }
        elements.btnDrawMode?.setAttribute('disabled', 'true');

        // 비디오 줌 컨트롤 숨기기
        elements.videoZoomControls?.classList.add('hidden');

        // 오디오 모드: 불필요한 비디오 컨트롤 숨기기
        elements.btnDrawMode?.closest('.action-btn-wrapper, .action-btn')?.classList.add('audio-hidden');
        document.getElementById('frameIndicator')?.classList.add('audio-hidden');

        elements.videoWrapper?.classList.add('audio-mode');
        document.body.classList.add('audio-mode');
        if (driveLoadingFeedbackShown && fileIsAudio) {
          hideVideoLoadingOverlay('drive');
        }
      } else {
        // 비디오 모드
        state.isAudioMode = false;
        videoPlayer.isAudioMode = false;

        // 오디오 웨이브폼 숨기기
        audioWaveform.hide();
        audioWaveform.reset();

        elements.videoWrapper?.classList.remove('audio-mode');
        document.body.classList.remove('audio-mode');
        elements.btnDrawMode?.removeAttribute('disabled');
        elements.videoZoomControls?.classList.remove('hidden');

        // 오디오 모드에서 숨겼던 컨트롤 복원
        elements.btnDrawMode?.closest('.action-btn-wrapper, .action-btn')?.classList.remove('audio-hidden');
        document.getElementById('frameIndicator')?.classList.remove('audio-hidden');

        if (useMpvPilot) {
          try {
            const mpvLoaded = await loadVideoWithMpvPilot(filePath, {
              initialFrame,
              initialTime,
              loadToken,
              isStaleVideoLoad
            });
            if (!canContinueVideoLoad()) return false;
            if (!mpvLoaded) {
              log.warn('mpv 파일럿 준비가 중단되어 기존 재생 방식으로 재시도');
              showToast('mpv 준비가 중단되어 기존 방식으로 다시 시도합니다.', 'warning');
              const fallbackOptions = {
                ...options,
                allowMpvPilot: false,
                preparedVideoPath: preparedVideoPathIsOriginal ? null : preparedVideoPath
              };
              return loadVideoWithHtml5Fallback(filePath, fallbackOptions);
            }
          } catch (mpvError) {
            if (!canContinueVideoLoad()) return false;
            log.warn('mpv 파일럿 로드 실패, 기존 재생 방식으로 재시도', { error: mpvError.message });
            showToast('mpv 재생에 실패해 기존 방식으로 다시 시도합니다.', 'warning');
            const fallbackOptions = {
              ...options,
              allowMpvPilot: false,
              preparedVideoPath: preparedVideoPathIsOriginal ? null : preparedVideoPath
            };
            return loadVideoWithHtml5Fallback(filePath, fallbackOptions);
          }
        } else {
          elements.videoWrapper?.classList.remove('mpv-pilot-mode');
          document.body.classList.remove('mpv-pilot-mode');

          // 비디오 플레이어에 로드 (트랜스코딩된 경우 변환된 파일 사용)
          const html5InitialFrame = () => resolveInitialFrameFromOptions(initialFrame, initialTime);
          const shouldDelayVideoReveal = revealAfterInitialSeek &&
            (Number.isFinite(Number(initialFrame)) && Number(initialFrame) > 0 ||
              Number.isFinite(Number(initialTime)) && Number(initialTime) > 0);
          const shouldHoldVideoReveal = holdPreviousFrameUntilReady || shouldDelayVideoReveal;
          const previousVideoVisibility = elements.videoPlayer.style.visibility;
          const transitionFreezeCaptured = shouldHoldVideoReveal && captureVideoTransitionFreezeFrame();
          const shouldHideVideoDuringLoad = shouldHoldVideoReveal;
          if (shouldHideVideoDuringLoad) {
            elements.videoPlayer.style.visibility = 'hidden';
          }

          try {
            const html5Fps = html5ProbedFps ?? (fileIsAudio ? 24 : await resolveHtml5PlaybackFps(filePath));
            if (!canContinueVideoLoad()) return false;
            videoPlayer.setFps(html5Fps);
            await videoPlayer.load(actualVideoPath);
            if (!canContinueVideoLoad()) return false;

            // 피드백 36: reveal 지연이 없는 경로에서도 초 단위 위치를 복원한다.
            if (!shouldDelayVideoReveal) {
              const resumeFrame = resolveInitialFrameFromOptions(initialFrame, initialTime);
              if (Number.isFinite(Number(resumeFrame)) && Number(resumeFrame) > 0) {
                videoPlayer.seekToFrame(resumeFrame);
              }
            }

            if (shouldDelayVideoReveal) {
              await seekInitialVideoFrameBeforeReveal(html5InitialFrame());
              if (!canContinueVideoLoad()) return false;
            } else if (shouldHoldVideoReveal) {
              await waitForVideoRenderable(elements.videoPlayer);
              if (!canContinueVideoLoad()) return false;
              await waitForNextVideoPaint(elements.videoPlayer);
              if (!canContinueVideoLoad()) return false;
            }
          } finally {
            if (shouldHideVideoDuringLoad) {
              elements.videoPlayer.style.visibility = previousVideoVisibility;
              releaseVideoTransitionFreezeFrame(transitionFreezeCaptured);
            }
          }
        }
      }

      // 원본 파일 경로 저장 (UI/메타데이터용)
      state.currentFile = filePath;
      elements.fileName.textContent = fileInfo.name;
      elements.fileName.classList.remove('file-name-clickable'); // 파일 로드 후 클릭 가능 상태 제거
      elements.filePath.textContent = fileInfo.dir;
      elements.dropZone.classList.add('hidden');

      if (playWhenMediaReady && shouldContinueVideoLoad()) {
        await playVideoAfterMediaLoad({ silent: true });
      }

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
        if (!canContinueVideoLoad()) return false;
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
          // 피드백 36: 전환 직전 위치(초)를 캡처해 새 버전에서도 같은 시간으로 이어본다.
          const resumeTime = Number.isFinite(Number(videoPlayer.currentTime)) && Number(videoPlayer.currentTime) > 0
            ? Number(videoPlayer.currentTime)
            : null;
          // 버전 컨텍스트 유지하고, 해당 버전 번호도 함께 전달
          await loadVideo(versionInfo.path, {
            keepVersionContext: true,
            targetVersion: versionInfo.version,
            initialTime: resumeTime
          });
        }
      });

      // 비디오 트랙 업데이트
      elements.videoTrackClip.textContent = fileIsAudio ? `🎵 ${fileInfo.name}` : `📹 ${fileInfo.name}`;

      // 썸네일 생성 시작 (비디오만, 트랜스코딩된 경우 변환된 파일 사용)
      if (!fileIsAudio) {
        // 작업 4: engineSwap은 같은 파일 — 썸네일 재생성 생략(타임라인 깜빡임·비용 회피)
        if (!engineSwap) {
          let shouldGenerateThumbnails = true;
          if (useMpvPilot) {
            thumbnailVideoPath = await resolveMpvThumbnailVideoPath(filePath, {
              isStaleVideoLoad
            });
            if (!canContinueVideoLoad()) return false;
            shouldGenerateThumbnails = Boolean(thumbnailVideoPath);
          }
          if (shouldGenerateThumbnails) {
            await generateThumbnails(thumbnailVideoPath);
          } else {
            getThumbnailGenerator().clear();
            if (driveLoadingFeedbackShown) {
              hideVideoLoadingOverlay('drive');
            }
            document.getElementById('videoLoadingOverlay')?.classList.remove('active');
          }
          if (!canContinueVideoLoad()) return false;
        } // end if (!engineSwap) — 썸네일 재생성
      } else {
        // 오디오 파일 로드 시 이전 비디오의 썸네일 상태 정리
        getThumbnailGenerator().clear();
      }

      // .bframe 파일 로드 시도 (이미 저장했으므로 skipSave: true)
      // 작업 4: engineSwap에서는 같은 파일이므로 .bframe 재로드를 건너뛴다(메모리 데이터 유지).
      let hasExistingData = false;
      let currentBframePath = reviewDataManager.currentBframePath;
      if (!engineSwap) {
        hasExistingData = await reviewDataManager.setVideoFile(filePath, {
          skipSave: true,
          fabricDrawingPersistenceContext: {
            fps: videoPlayer.fps,
            totalFrames: Math.max(1, Math.round(videoPlayer.totalFrames)),
            stableVideoIdentity: filePath
          }
        });
        if (!canContinueVideoLoad()) return false;
        currentBframePath = reviewDataManager.currentBframePath;
      }
      reviewDataManager.setFps(videoPlayer.fps);

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

      // 작업 4: engineSwap에서는 "로드됨" 토스트·협업 재시작을 건너뛴다(같은 파일 — 세션 유지).
      if (!engineSwap) {
        if (hasExistingData) {
          showToast(`"${fileInfo.name}" 로드됨 (리뷰 데이터 복원)`, 'success');
        } else {
          showToast(`"${fileInfo.name}" 로드됨`, 'success');
        }

        if (hasExistingData) {
          if (deferCollaborationStart) {
            scheduleDeferredCollaborationStart(loadToken, currentBframePath);
          } else {
            await startCollaborationForVideoLoad(loadToken, currentBframePath);
            if (!canContinueVideoLoad()) return false;
          }
        } else {
          startDeferredReviewFileDiscovery(loadToken, currentBframePath);
        }
      } // end if (!engineSwap) — 토스트·협업

      // 마커 및 그리기 렌더링 업데이트 (항상 실행)
      renderVideoMarkers();
      updateTimelineMarkers();
      updateCommentList();
      // 그리기 레이어 UI 및 캔버스 다시 렌더링
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      drawingManager.renderFrame(videoPlayer.currentFrame);
      compositionLayerManager.setVideoInfo({ duration: videoPlayer.duration });
      compositionLayerManager.setPlaybackState({
        currentTime: videoPlayer.currentTime,
        isPlaying: videoPlayer.isPlaying
      });
      compositionLayerManager.render();
      renderCompositionLayerTimeline();

      // 하이라이트 매니저 영상 정보 설정 및 렌더링
      highlightManager.setVideoInfo(videoPlayer.duration, videoPlayer.fps);
      renderHighlights();

      // 댓글 범위 렌더링
      await refreshCommentRangesForCurrentMode({
        skipContinuousTimelineRefresh: preserveContinuousSession
      });
      if (!canContinueVideoLoad()) return false;

      // ====== 최근 파일 목록에 추가 ======
      // fire-and-forget: manager 내부에서 자체 에러 처리함
      // 작업 4: engineSwap은 같은 파일 재등록 불필요 — 건너뛴다.
      if (!engineSwap) {
        recentFilesManager.add({
          path: filePath,
          name: fileInfo.name,
          dir: fileInfo.dir,
          ext: fileInfo.ext,
          size: fileInfo.size,
          duration: videoPlayer.duration || 0
        });
      }

      if (!engineSwap && canContinueVideoLoad()) {
        await fabricDrawingPilotController.afterVideoReady({
          ...getFabricDrawingPilotContext(),
          loadToken
        });
        if (!canContinueVideoLoad()) return false;
      }

      trace.end({ filePath, hasExistingData });
      videoLoadCompleted = true;
      return true;

    } catch (error) {
      trace.error(error);
      // 에러 발생 시에도 자동 저장 재개
      reviewDataManager.resumeAutoSave();
      if (driveLoadingFeedbackShown) {
        hideVideoLoadingOverlay('drive');
      }
      showToast('파일을 로드할 수 없습니다.', 'error');
      return false;
    } finally {
      if (activeVideoLoadToken === loadToken) {
        if (!engineSwap && !videoLoadCompleted) {
          await fabricDrawingPilotController.cancelVideoChange(loadToken);
        }
        activeVideoLoadToken = null;
        activeVideoLoadPath = null;
        await settlePendingMpvReviewFreezeMediaChange({ loaded: videoLoadCompleted });
        retryDeferredMpvOverlayFallback();
      }
    }
  }

  // 피드백 36: 이전 버전 댓글 읽기 전용 표시 상태
  let previousVersionComments = null; // { label, comments: [...평탄화된 마커...] } | null

  async function togglePreviousVersionComments(versionInfo) {
    if (!versionInfo?.path) {
      previousVersionComments = null;
      updateCommentList();
      return;
    }
    try {
      const sourceData = await window.electronAPI.loadReview(getBframePath(versionInfo.path));
      const sourceComments = normalizeFeedbackSourceComments(sourceData);
      const markers = [];
      (sourceComments?.layers || []).forEach((layer) => {
        (layer?.markers || []).forEach((marker) => {
          if (marker) markers.push(marker);
        });
      });
      previousVersionComments = {
        label: versionInfo.displayLabel || (versionInfo.version ? `v${versionInfo.version}` : versionInfo.fileName || '이전 버전'),
        comments: markers
      };
    } catch (error) {
      log.warn('이전 버전 댓글 로드 실패', { path: versionInfo.path, error: error?.message });
      showToast('선택한 버전의 피드백 파일을 열 수 없습니다.', 'warning');
      previousVersionComments = null;
    }
    updateCommentList();
  }

  async function handleImportFeedbackFromVersion(versionInfo) {
    if (!state.currentFile) {
      showToast('먼저 피드백을 받을 버전을 열어주세요.', 'warning');
      return false;
    }

    if (!versionInfo?.path) {
      showToast('피드백을 가져올 버전 파일을 찾을 수 없습니다.', 'warning');
      return false;
    }

    if (isSameFilePath(versionInfo.path, state.currentFile)) {
      showToast('현재 열려 있는 버전에서는 피드백을 가져올 수 없습니다.', 'info');
      return false;
    }

    const sourceBframePath = getBframePath(versionInfo.path);
    let sourceData = null;

    try {
      sourceData = await window.electronAPI.loadReview(sourceBframePath);
    } catch (error) {
      log.warn('피드백 가져오기 소스 로드 실패', {
        sourceBframePath,
        error: error.message
      });
      showToast('선택한 버전의 피드백 파일을 열 수 없습니다.', 'warning');
      return false;
    }

    const sourceComments = normalizeFeedbackSourceComments(sourceData);
    const sourceCount = countImportableFeedbackMarkers(sourceComments);
    if (sourceCount <= 0) {
      showToast('선택한 버전에 가져올 피드백이 없습니다.', 'info');
      return false;
    }

    const sourceLabel = versionInfo.displayLabel || (versionInfo.version ? `v${versionInfo.version}` : versionInfo.fileName || '선택한 버전');
    const confirmed = confirm(`${sourceLabel}에서 피드백 ${sourceCount}개를 현재 버전으로 가져올까요?`);
    if (!confirmed) return false;

    const targetLayerId = commentManager.activeLayerId || commentManager.getActiveLayer()?.id || 'comment-layer-1';
    const result = importFeedbackIntoTargetComments(
      commentManager.toJSON(),
      sourceComments,
      { targetLayerId }
    );

    if (result.importedCount <= 0) {
      showToast('가져올 수 있는 피드백이 없습니다.', 'info');
      return false;
    }

    const importedMarkers = commentManager.addImportedMarkers(result.importedMarkers, targetLayerId);
    if (importedMarkers.length <= 0) {
      showToast('가져올 수 있는 피드백이 없습니다.', 'info');
      return false;
    }

    commentManager.setActiveLayer(importedMarkers[0].layerId || targetLayerId);
    const saved = await reviewDataManager.save();

    updateCommentList();
    updateTimelineMarkers();
    renderVideoMarkers();
    await refreshCommentRangesForCurrentMode();

    if (!saved) {
      showToast('피드백은 화면에 추가됐지만 저장에 실패했습니다.', 'error');
      return false;
    }

    showToast(`피드백 ${importedMarkers.length}개를 가져왔습니다.`, 'success');
    return true;
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

    // 로딩 오버레이는 실제 생성 시에만 표시 (캐시 히트 시 표시 안 함)
    let overlayShown = false;

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
      if (thumbnailListeners.exactCaptured) {
        thumbnailGenerator.removeEventListener('exactCaptured', thumbnailListeners.exactCaptured);
      }

      // 기존 썸네일 정리
      thumbnailGenerator.clear();

      // 진행률 이벤트 리스너 (실제 생성 시에만 발생)
      const onProgress = (e) => {
        const { progress, phase, current, total } = e.detail;

        // 첫 progress 이벤트에서 오버레이 표시 (캐시 히트 시에는 progress가 발생하지 않음)
        if (!overlayShown) {
          overlayShown = true;
          loadingOverlay?.classList.add('active');
          if (loadingOverlay) loadingOverlay.dataset.loadingKind = 'thumbnail';
          loadingProgress.style.width = '0%';
        }

        loadingProgress.style.width = `${progress * 100}%`;

        if (phase === 1) {
          loadingText.textContent = `썸네일 생성 중... (${current}/${total})`;
        } else {
          loadingText.textContent = `썸네일 세부 생성 중... (${current}/${total})`;
        }
      };

      // 1단계 완료 시 (빠른 스캔 완료 또는 캐시 로드 완료) - 즉시 로딩 해제
      const onQuickReady = (e) => {
        thumbnailGenerator.removeEventListener('quickReady', onQuickReady);
        const fromCache = e.detail?.fromCache;

        // 타임라인에 썸네일 생성기 연결 (1단계 완료 즉시)
        timeline.setThumbnailGenerator(thumbnailGenerator);

        // 댓글 리스트 업데이트 (썸네일 표시를 위해)
        updateCommentList(getActiveCommentFilter());

        // 로딩 오버레이 숨김 (외부 파일 열기 등에서 미리 표시된 경우도 포함)
        loadingOverlay?.classList.remove('active');
        if (loadingOverlay) delete loadingOverlay.dataset.loadingKind;

        if (fromCache) {
          log.info('썸네일 캐시에서 로드 완료');
        } else {
          log.info('썸네일 1단계 완료 - UI 사용 가능');
          showToast('미리보기 준비 완료! (세부 생성 중...)', 'success');
        }
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

      // 정확 프레임 온디맨드 캡처 완료 → 사이드바 댓글 썸네일 교체 (진적 갱신)
      const onExactCaptured = (ev) => {
        const detail = ev.detail || {};
        const { time, dataUrl } = detail;
        if (!dataUrl || typeof time !== 'number') return;
        const frame = Math.round(time * (videoPlayer.fps || 24));
        document.querySelectorAll(
          `.comment-item[data-start-frame="${frame}"] .comment-thumbnail`
        ).forEach(img => { img.src = dataUrl; });
      };
      thumbnailListeners.exactCaptured = onExactCaptured;

      thumbnailGenerator.addEventListener('progress', onProgress);
      thumbnailGenerator.addEventListener('quickReady', onQuickReady);
      thumbnailGenerator.addEventListener('complete', onComplete);
      thumbnailGenerator.addEventListener('exactCaptured', onExactCaptured);

      // 비디오 소스 경로 (file:// 프로토콜 추가)
      const videoSrc = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

      // 썸네일 생성 시작 (비동기, 완료 대기 안함)
      thumbnailGenerator.generate(videoSrc);

    } catch (error) {
      log.error('썸네일 생성 실패', error);
      showToast('썸네일 생성에 실패했습니다.', 'warning');
      // 실패 시에도 오버레이 숨김
      loadingOverlay?.classList.remove('active');
      if (loadingOverlay) delete loadingOverlay.dataset.loadingKind;
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
    const rate = Math.max(1, Math.round(Number(fps) || 24));
    // Math.round로 부동소수점 오차 방지
    const totalFrames = Math.round((Number(seconds) || 0) * rate);
    const f = totalFrames % rate;
    const totalSeconds = Math.floor(totalFrames / rate);
    const s = totalSeconds % 60;
    const m = Math.floor((totalSeconds % 3600) / 60);
    const h = Math.floor(totalSeconds / 3600);

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }

  function formatFpsLabel(fps) {
    const value = Number(fps) || 24;
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  /**
   * 타임코드 디스플레이 업데이트
   */
  function updateTimecodeDisplay() {
    if (playlistUIState.mode === 'continuous' && timeline.playlistDuration > 0) {
      const segment = getCurrentContinuousSegment();
      const globalTime = getContinuousTimelinePlaybackTime();
      const globalFps = segment?.fps || videoPlayer.fps || 24;
      const localDuration = segment?.duration || videoPlayer.duration || 0;
      elements.timecodeCurrent.textContent = `전체 ${formatPlaylistTimecode(globalTime, globalFps)}`;
      elements.timecodeTotal.textContent =
        `${formatPlaylistTimecode(timeline.playlistDuration, globalFps)} · 컷 ${formatPlaylistTimecode(videoPlayer.currentTime, videoPlayer.fps)} / ${formatPlaylistTimecode(localDuration, videoPlayer.fps)}`;
    } else {
      elements.timecodeCurrent.textContent = videoPlayer.getCurrentTimecode();
      elements.timecodeTotal.textContent = videoPlayer.getDurationTimecode();
    }
    elements.frameIndicator.textContent =
      `${formatFpsLabel(videoPlayer.fps)}fps · Frame ${videoPlayer.currentFrame} / ${videoPlayer.totalFrames}`;
  }

  /**
   * 그리기 모드 토글
   */
  function setCommentOverlaysDrawingPassthrough(enabled) {
    markerContainer.classList.toggle('drawing-active', enabled);
    document.body.classList.toggle('drawing-mode-active', enabled);
    if (!enabled) return;

    document.querySelectorAll('.comment-marker-tooltip').forEach(tooltip => {
      tooltip.classList.remove('visible', 'pinned');
    });
  }

  function setDrawModeReadyState(ready) {
    elements.btnDrawMode?.classList.toggle('active', ready);
    elements.drawingTools?.classList.toggle('visible', ready);
    elements.drawingCanvas?.classList.toggle('active', ready);
    elements.videoWrapper?.classList.toggle('drawing-mode', ready);
    setCommentOverlaysDrawingPassthrough(ready);
  }

  function setDrawModePreparingState(preparing) {
    elements.videoWrapper?.classList.toggle('drawing-mode-preparing', preparing);
    elements.btnDrawMode?.classList.toggle('preparing', preparing);
    elements.btnDrawMode?.setAttribute('aria-busy', String(preparing));
  }

  function notifyFabricDrawingPilotFailure() {
    if (fabricDrawingPilotFailureToastShown) return;
    fabricDrawingPilotFailureToastShown = true;
    showToast('새 드로잉 화면을 준비하지 못했습니다.', 'error');
  }

  function handleFabricDrawingPilotStateChange(nextState, snapshot) {
    const active = nextState === 'active';
    const preparing = nextState === 'preparing';
    const recoveringForResume = nextState === 'recovering' && snapshot?.resumeRequested === true;
    const engaged = isMpvPilotPlaybackActive() &&
      (active || preparing || nextState === 'recovering');
    const wasEngaged = fabricDrawingPilotUiEngaged;
    scheduleFabricPilotStatusRefresh({ force: true });
    scheduleMpvOverlayStateSync({ force: true });
    if (!engaged && !wasEngaged) {
      if (nextState === 'failed') notifyFabricDrawingPilotFailure();
      else fabricDrawingPilotFailureToastShown = false;
      return;
    }
    fabricDrawingPilotUiEngaged = engaged;

    document.body.classList.toggle('fabric-drawing-pilot-engaged', engaged);
    state.isDrawMode = nextState === 'active' || nextState === 'preparing';
    setDrawModePreparingState(preparing || recoveringForResume);
    setDrawModeReadyState(false);
    elements.btnDrawMode?.classList.toggle('active', active);

    if (nextState === 'failed') {
      notifyFabricDrawingPilotFailure();
      return;
    }
    fabricDrawingPilotFailureToastShown = false;
  }

  function exitDrawModeForSystemPath() {
    if (isFabricDrawingPilotControllerEngaged()) {
      void fabricDrawingPilotController.disable();
      return;
    }
    applyDrawModeState(false);
  }

  async function prepareMpvDrawMode(preparationToken) {
    return prepareMpvCommentReadiness({
      prepareFreeze: () => showMpvReviewFreezeFrame(),
      isStillActive: () => (
        preparationToken === drawModePreparationToken &&
        state.isDrawMode &&
        isMpvPilotPlaybackActive()
      ),
      setReady: setDrawModeReadyState,
      setPreparing: setDrawModePreparingState,
      showGuidance: () => {}
    });
  }

  function applyDrawModeState(enabled) {
    const preparationToken = ++drawModePreparationToken;
    state.isDrawMode = enabled;
    if (enabled && state.isCommentMode) {
      commentManager.setCommentMode(false);
    }
    if (enabled && isMpvPilotPlaybackActive()) {
      videoPlayer.pause();
      // 작업 4: 하이브리드 우선 — HTML5 직재생 가능하면 엔진 전환, 아니면 기존 freeze 준비.
      // (c-0)의 skipReviewTransition 덕에 preparationToken이 보존되어 실패 폴백이 성립한다.
      void enterHybridReviewEngineIfPossible().then((swapped) => {
        // 전환 중 사용자가 모드를 껐으면(B 재입력) 캔버스를 활성화하지 않고 mpv 복귀만 정리
        if (!state.isDrawMode) {
          void exitHybridReviewEngineIfNeeded();
          return;
        }
        if (swapped) {
          setDrawModePreparingState(false);
          setDrawModeReadyState(true);
        } else {
          void prepareMpvDrawMode(preparationToken);
        }
      });
    } else {
      setDrawModePreparingState(false);
      setDrawModeReadyState(enabled);
    }
    if (!enabled) {
      mpvDrawPlaybackTransitionToken += 1;
      elements.drawingTools?.classList.remove('playback-hidden');
      if (!isMpvReviewInteractionActive()) {
        void releaseMpvReviewFreezeFrame();
      }
      drawingManager.commitActiveSelection();
      scheduleMpvOverlayStateSync({ force: true });
      state.isSpaceHeld = false;
      state.spacePanUsed = false;
      elements.videoWrapper?.classList.remove('space-pan');
      void exitHybridReviewEngineIfNeeded();
    }
  }

  function toggleDrawMode() {
    // 오디오 모드에서는 그리기 모드 진입 차단
    if (state.isAudioMode) return;
    if (fabricDrawingPilotController.isEnabled() && isMpvPilotPlaybackActive()) {
      void fabricDrawingPilotController.toggle();
      return;
    }
    const shouldEnable = !state.isDrawMode;
    if (shouldEnable) {
      applyDrawModeState(true);
      if (state.isCommentMode) {
        commentManager.setCommentMode(false);
      }
    } else {
      applyDrawModeState(false);
    }
    log.debug('그리기 모드 변경', { isDrawMode: state.isDrawMode });
  }

  /**
   * 댓글 모드 토글
   */
  function toggleCommentMode() {
    const shouldEnable = !state.isCommentMode;
    if (shouldEnable) {
      commentManager.setCommentMode(true);
      if (state.isDrawMode || isFabricDrawingPilotControllerEngaged()) {
        exitDrawModeForSystemPath();
      }
    } else {
      commentManager.setCommentMode(false);
    }
  }

  /**
   * 전체화면 모드 토글 (시스템 전체화면)
   */
  let fullscreenMouseHandler = null;

  function setFullscreenControlsVisible(visible) {
    const wasVisible = document.body.classList.contains('show-controls');
    document.body.classList.toggle('show-controls', visible);
    if (wasVisible !== visible) {
      scheduleMpvEmbedBoundsSyncAfterLayout();
      // 피드백 28(a): 컨트롤바 슬라이드 트랜지션(0.3s)이 끝난 뒤 미러를 최종 위치로 맞춘다.
      setTimeout(() => {
        scheduleMpvOverlayStateSync({ force: true });
      }, MPV_OVERLAY_FADE_OUT_SYNC_DELAY_MS);
    }
  }

  async function toggleFullscreen() {
    // Electron 시스템 전체화면 API 호출
    await window.electronAPI.toggleFullscreen();
    const isFullscreen = await window.electronAPI.isFullscreen();

    state.isFullscreen = isFullscreen;
    document.body.classList.toggle('app-fullscreen', isFullscreen);
    scheduleMpvEmbedBoundsSyncAfterLayout();

    // 오디오 모드: 전체화면 전환 시 웨이브폼 캔버스 리사이즈
    if (state.isAudioMode) {
      const audioWaveform = getAudioWaveform();
      // 레이아웃 변경이 반영될 때까지 대기 후 리사이즈
      requestAnimationFrame(() => {
        audioWaveform._onResize();
      });
    }

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
          setFullscreenControlsVisible(true);
        } else {
          setFullscreenControlsVisible(false);
        }
      };
      document.addEventListener('mousemove', fullscreenMouseHandler);
    } else {
      finishFullscreenMiddleScrub();

      // 전체화면 해제 시 이벤트 리스너 제거
      if (fullscreenMouseHandler) {
        document.removeEventListener('mousemove', fullscreenMouseHandler);
        fullscreenMouseHandler = null;
      }
      // 타임코드 오버레이 제거
      if (fullscreenTimecodeOverlay) {
        fullscreenTimecodeOverlay.remove();
        fullscreenTimecodeOverlay = null;
        scheduleMpvOverlayStateSync();
      }
      setFullscreenControlsVisible(false);
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
    const fps = Math.max(1, Math.round(Number(videoPlayer.fps) || 24));

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
    scheduleMpvOverlayStateSync();
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

  const fullscreenSeekbar = document.getElementById('fullscreenSeekbar');

  function setFullscreenSeekbarScrubbing(scrubbing) {
    fullscreenSeekbar?.classList.toggle('is-scrubbing', scrubbing);
  }

  function canStartFullscreenMiddleScrub(e) {
    return e.button === 1 &&
      !state.isDrawMode &&
      videoPlayer.isLoaded &&
      videoPlayer.duration > 0;
  }

  function startFullscreenMiddleScrub(e) {
    state.isFullscreenScrubbing = true;
    state.fullscreenScrubStartX = e.clientX;
    state.fullscreenScrubStartTime = videoPlayer.currentTime || 0;
    state.fullscreenScrubDuration = videoPlayer.duration || 0;
    elements.videoWrapper?.classList.add('fullscreen-scrubbing');
    setFullscreenSeekbarScrubbing(true);
    showFullscreenScrubOverlay(state.fullscreenScrubStartTime);
    e.preventDefault();
  }

  function updateFullscreenMiddleScrub(e) {
    if (!state.isFullscreenScrubbing) return;

    if (e.buttons === 0 || (e.buttons & 4) === 0) {
      finishFullscreenMiddleScrub();
      return;
    }

    const dx = e.clientX - state.fullscreenScrubStartX;
    const timeDelta = (dx / Math.max(1, window.innerWidth)) * state.fullscreenScrubDuration;
    const targetTime = Math.max(
      0,
      Math.min(state.fullscreenScrubDuration, state.fullscreenScrubStartTime + timeDelta)
    );

    videoPlayer.seek(targetTime);
    updateFullscreenTimecode();
    updateFullscreenSeekbar();
    showFullscreenScrubOverlay(targetTime);
    e.preventDefault();
  }

  function finishFullscreenMiddleScrub() {
    if (!state.isFullscreenScrubbing) return;

    state.isFullscreenScrubbing = false;
    elements.videoWrapper?.classList.remove('fullscreen-scrubbing');
    setFullscreenSeekbarScrubbing(false);
    hideFullscreenScrubOverlay();
  }

  function ensureFullscreenScrubOverlay() {
    if (fullscreenScrubOverlay) return fullscreenScrubOverlay;

    fullscreenScrubOverlay = document.createElement('div');
    fullscreenScrubOverlay.className = 'fullscreen-scrub-overlay';
    fullscreenScrubOverlay.innerHTML = `
      <div class="fullscreen-scrub-track">
        <div class="fullscreen-scrub-progress"></div>
      </div>
      <div class="fullscreen-scrub-time">00:00:00:00 / 00:00:00:00</div>
    `;
    document.body.appendChild(fullscreenScrubOverlay);
    return fullscreenScrubOverlay;
  }

  function showFullscreenScrubOverlay(time) {
    if (!state.isFullscreen) return;

    const overlay = ensureFullscreenScrubOverlay();
    const duration = state.fullscreenScrubDuration || videoPlayer.duration || 0;
    const fps = videoPlayer.fps || 24;
    const percent = duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;

    overlay.querySelector('.fullscreen-scrub-progress').style.width = `${percent}%`;
    overlay.querySelector('.fullscreen-scrub-time').textContent =
      `${formatTimecode(time, fps)} / ${formatTimecode(duration, fps)}`;
    overlay.classList.add('visible');
    scheduleMpvOverlayStateSync();
  }

  function hideFullscreenScrubOverlay() {
    fullscreenScrubOverlay?.classList.remove('visible');
    scheduleMpvOverlayStateSync();
    setTimeout(() => {
      if (!fullscreenScrubOverlay?.classList.contains('visible')) {
        scheduleMpvOverlayStateSync({ force: true });
      }
    }, MPV_OVERLAY_FADE_OUT_SYNC_DELAY_MS);
  }

  // 전체화면 시크바 이벤트 설정
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
      if (e.button !== 0) return;

      isSeeking = true;
      setFullscreenSeekbarScrubbing(true);
      seekToPosition(e);
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (isSeeking) {
        seekToPosition(e);
      }
    });

    document.addEventListener('mouseup', () => {
      isSeeking = false;
      setFullscreenSeekbarScrubbing(false);
    });

    fullscreenSeekbar.addEventListener('click', (e) => {
      if (e.button === 0) {
        seekToPosition(e);
      }
    });
  }

  /**
   * Pending 마커 렌더링 (클릭 후 텍스트 입력 대기 상태)
   */
  function renderPendingMarker(marker) {
    removePendingMarkerUI();
    elements.videoWrapper?.classList.add('comment-pending');

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
    inputWrapper.classList.toggle('align-left', marker.x > 0.68);
    inputWrapper.classList.toggle('align-above', marker.y > 0.72);
    inputWrapper.classList.toggle('align-below', marker.y < 0.22);
    inputWrapper.innerHTML = `
      <textarea class="comment-marker-input" placeholder="댓글 입력..." rows="1"></textarea>
      <div class="comment-marker-input-hint">Enter 확인 · Shift+Enter 줄바꿈 · Esc 취소</div>
    `;
    inputWrapper.addEventListener('pointerdown', (e) => e.stopPropagation());
    inputWrapper.addEventListener('mousedown', (e) => e.stopPropagation());

    markerEl.appendChild(inputWrapper);
    markerContainer.appendChild(markerEl);

    // 입력창 포커스
    const textarea = inputWrapper.querySelector('textarea');
    setTimeout(() => textarea?.focus(), 50);

    // 멘션 자동완성 부착
    if (textarea) mentionManager.attach(textarea);

    // 자동 높이 조절 함수
    const autoResize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    };

    // 입력 시 자동 크기 조절
    textarea?.addEventListener('input', () => {
      autoResize();
      scheduleMpvOverlayStateSync();
    });

    // Enter로 확정, Shift+Enter로 줄바꿈
    textarea?.addEventListener('keydown', (e) => {
      if (mentionManager.isVisible) return;
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
          // pending 마커 내 입력 필드에 포커스가 이동한 경우 모드 해제하지 않음
          const pendingInput = markerEl?.querySelector('textarea, input');
          if (pendingInput && document.activeElement === pendingInput) {
            clickedInsideMarker = false;
            return;
          }
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
    scheduleMpvOverlayStateSync();
  }

  /**
   * Pending 마커 UI 제거
   */
  function removePendingMarkerUI() {
    const pending = markerContainer.querySelector('.comment-marker.pending');
    if (pending) {
      pending.remove();
    }
    elements.videoWrapper?.classList.remove('comment-pending');
    scheduleMpvOverlayStateSync();
  }

  /**
   * 영상 위 마커들 렌더링
   */
  function renderVideoMarkers() {
    // 기존 확정된 마커들 제거
    markerContainer.querySelectorAll('.comment-marker:not(.pending)').forEach(el => el.remove());
    // body에 있는 기존 툴팁들도 제거
    document.querySelectorAll('.comment-marker-tooltip').forEach(el => el.remove());

    // 마커 토글이 꺼져있으면 렌더링 스킵
    if (!commentFilterState.showMarkers) {
      updateVideoMarkersVisibility();
      return;
    }

    let allMarkers = commentManager.getAllMarkers();

    // 작성자 필터 적용
    allMarkers = filterByAuthors(allMarkers);

    allMarkers.forEach(marker => {
      renderSingleMarker(marker);
    });

    updateVideoMarkersVisibility();
    scheduleMpvOverlayStateSync();
  }

  /**
   * 단일 마커 렌더링
   */
  function renderSingleMarker(marker) {
    const markerEl = document.createElement('div');
    markerEl.className = `comment-marker${marker.resolved ? ' resolved' : ''}`;
    markerEl.dataset.markerId = marker.id;
    const authorColor = getAuthorColor(marker.authorId || marker.author || 'unknown');
    markerEl.style.cssText = `
      position: absolute;
      left: ${marker.x * 100}%;
      top: ${marker.y * 100}%;
      transform: translate(-50%, -50%);
      ${!marker.resolved ? `background: ${authorColor.color};` : ''}
    `;

    // 말풍선 (툴팁) - body에 추가하여 transform 영향 안받게
    const tooltip = document.createElement('div');
    tooltip.className = 'comment-marker-tooltip';
    tooltip.dataset.markerId = marker.id;
    const authorClass = getAuthorColorClass(marker.author);
    const resolveTitle = getResolveButtonLabel(marker.resolved, marker.resolvedBy);
    tooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-timecode">${marker.startTimecode}</span>
        <span class="tooltip-author ${authorClass}">${escapeHtml(marker.author)}</span>
      </div>
      <div class="tooltip-text">${renderGDriveLinks(escapeHtml(marker.text))}</div>
      <div class="tooltip-actions">
        <button class="tooltip-btn resolve" title="${escapeHtmlAttribute(resolveTitle)}" aria-label="${escapeHtmlAttribute(resolveTitle)}">
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
      scheduleMpvOverlayStateSync();
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
      scheduleMpvOverlayStateSync({ force: true });

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
        scheduleMpvOverlayStateSync();
      }
    };

    const hideTooltipHover = () => {
      if (!marker.pinned && !isDragging) {
        hideTimeout = setTimeout(() => {
          tooltip.classList.remove('visible');
          scheduleMpvOverlayStateSync();
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

    // 해결 버튼
    tooltip.querySelector('.tooltip-btn.resolve')?.addEventListener('click', (e) => {
      e.stopPropagation();
      commentManager.toggleMarkerResolved(marker.id, userName);
    });

    // 삭제 버튼
    tooltip.querySelector('.tooltip-btn.delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();

      // 권한 체크 (본인 코멘트만 삭제 가능)
      if (!commentManager.canEdit(marker)) {
        showToast('본인 코멘트만 삭제할 수 있습니다.', 'warning');
        return;
      }

      if (confirm('댓글을 삭제하시겠습니까?')) {
        const markerData = marker.toJSON();
        commentManager.deleteMarker(marker.id);

        // UI 업데이트
        updateCommentList();
        updateTimelineMarkers();
        renderVideoMarkers();

        // Undo 스택에 추가 (save 전에 호출하여 시간순 보장)
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

        // 삭제 상태 저장 (협업 동기화용)
        await reviewDataManager.save();

        showToast('댓글이 삭제되었습니다.', 'info');
      }
    });

    // 마커 객체에 DOM 요소 참조 저장
    marker.element = markerEl;
    marker.tooltipElement = tooltip;
    marker.positionTooltip = positionTooltip;

    markerContainer.appendChild(markerEl);
    scheduleMpvOverlayStateSync();
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
    scheduleMpvOverlayStateSync();
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
      scheduleMpvOverlayStateSync();
    }
  }

  /**
   * 타임라인 마커 업데이트
   * 클러스터링 기반 렌더링 - 줌 레벨에 따라 가까운 마커 그룹화
   */
  function updateTimelineMarkers() {
    if (playlistUIState.mode === 'continuous') {
      timeline.clearCommentMarkers();
      return;
    }

    const ranges = cutlistUIState.active
      ? cutlistAggregateCommentRanges
      : commentManager.getMarkerRanges();
    const fps = videoPlayer.fps || 24;

    // 작성자 필터 적용
    let filteredRanges = ranges;
    if (cutlistUIState.active) {
      filteredRanges = filterCutlistAggregateCommentRanges(filteredRanges, commentFilterState.status);
    } else if (commentFilterState.authors !== null) {
      const filteredMarkers = filterByAuthors(commentManager.getAllMarkers());
      const allowedIds = new Set(filteredMarkers.map(m => m.id));
      filteredRanges = ranges.filter(r => allowedIds.has(r.markerId));
    }

    if (cutlistUIState.active) {
      filteredRanges = filteredRanges.map(range => ({
        ...range,
        aggregateCommentKey: range.aggregateCommentKey || getCutlistAggregateCommentKey(range)
      }));
    }

    // 프레임별로 마커 그룹화
    const frameMap = new Map();
    filteredRanges.forEach(range => {
      const markerFrame = Number(range.startFrame);
      if (!Number.isFinite(markerFrame)) return;
      if (!frameMap.has(markerFrame)) {
        frameMap.set(markerFrame, []);
      }
      frameMap.get(markerFrame).push(range);
    });

    // 클러스터링용 마커 데이터 배열 생성
    const allMarkerData = [];
    frameMap.forEach((markersAtFrame, frame) => {
      const time = cutlistUIState.active
        ? Number(markersAtFrame[0]?.globalStartTime)
        : frame / fps;
      const sourceFrame = cutlistUIState.active
        ? Number(markersAtFrame[0]?.sourceStartFrame ?? markersAtFrame[0]?.startFrame ?? frame)
        : frame;
      const allResolved = markersAtFrame.every(m => m.resolved);
      allMarkerData.push({
        time: Number.isFinite(time) ? time : frame / fps,
        frame: Number.isFinite(sourceFrame) ? sourceFrame : frame,
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
  let commentSearchKeyword = '';

  // ========== 가상 스크롤 상태 ==========
  const virtualScrollState = {
    allMarkers: [],
    filteredMarkers: [],
    renderedRange: { start: 0, end: 0 },
    itemHeight: 120, // 예상 아이템 높이
    bufferSize: 5,   // 위아래 버퍼
    currentFilter: 'all',
    currentSearch: '',
    scrollHandler: null
  };

  // 피드백 완료율 업데이트
  function normalizeCommentSearch(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  function markerMatchesCommentSearch(marker, normalizedQuery) {
    if (!normalizedQuery) return true;

    const cutlistLabel = getCutlistCommentLabelForMarker(marker);
    const searchTargets = [
      marker?.text,
      marker?.author,
      marker?.frame,
      marker?.startFrame,
      marker?.endFrame,
      cutlistLabel
    ];

    if (Array.isArray(marker?.replies)) {
      for (const reply of marker.replies) {
        searchTargets.push(reply?.text, reply?.author);
      }
    }

    const haystack = searchTargets
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value).toLowerCase())
      .join(' ');

    return haystack.includes(normalizedQuery);
  }

  function getCutlistCommentContextForMarker(marker) {
    if (!cutlistUIState.active || !marker) return null;
    const source = getCurrentCutlistSourceForFile(state.currentFile);
    if (!source) return null;
    return buildCutlistCommentContext(
      marker,
      getCutlistManager().getTimeline().segments,
      source.id
    );
  }

  function mapCutlistCommentRangesToTimeline(ranges = []) {
    if (!cutlistUIState.active) return ranges || [];
    const source = getCurrentCutlistSourceForFile(state.currentFile);
    if (!source) return [];
    const segments = getCutlistManager().getTimeline().segments;

    return (ranges || []).map((range) => {
      const context = buildCutlistCommentContext(range, segments, source.id);
      if (!context) return null;
      const fps = context.fps || videoPlayer.fps || 24;
      const frameCount = Math.max(1, Number(range.endFrame) - Number(range.startFrame));
      return {
        ...range,
        cutId: context.cutId,
        sourceStartFrame: range.startFrame,
        sourceEndFrame: range.endFrame,
        startFrame: context.globalStartFrame,
        endFrame: context.globalStartFrame + frameCount,
        globalStartTime: context.globalStartTime,
        globalEndTime: context.globalStartTime + (frameCount / fps)
      };
    }).filter(Boolean);
  }

  function getCutlistCommentLabelForMarker(marker) {
    const context = getCutlistCommentContextForMarker(marker);
    return context ? formatCutlistCommentLabel(context) : '';
  }

  function getCutlistCommentPanelLineForMarker(marker) {
    const context = getCutlistCommentContextForMarker(marker);
    return context
      ? formatCutlistCommentPanelLine({ ...context, text: marker?.text || '' })
      : '';
  }

  function highlightCommentSearchMatches(value, normalizedQuery) {
    const raw = value === undefined || value === null ? '' : String(value);
    if (!normalizedQuery) return escapeHtml(raw);

    const loweredRaw = raw.toLowerCase();
    const loweredQuery = normalizedQuery.toLowerCase();
    if (!loweredQuery) return escapeHtml(raw);

    let cursor = 0;
    let result = '';

    while (cursor < raw.length) {
      const foundAt = loweredRaw.indexOf(loweredQuery, cursor);
      if (foundAt === -1) {
        result += escapeHtml(raw.slice(cursor));
        break;
      }

      result += escapeHtml(raw.slice(cursor, foundAt));
      result += `<mark class="comment-search-highlight">${escapeHtml(raw.slice(foundAt, foundAt + loweredQuery.length))}</mark>`;
      cursor = foundAt + loweredQuery.length;
    }

    return result;
  }

  /**
   * HTML 문자열 내 @멘션을 하이라이팅 (TEAM_MEMBERS 이름만)
   * 정규식은 모듈 로드 시 1회만 빌드 (성능 최적화)
   */
  const _MENTION_PATTERN = (() => {
    const names = TEAM_MEMBERS.map(m => m.name).sort((a, b) => b.length - a.length);
    return new RegExp(`@(${names.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  })();

  function highlightMentions(html) {
    if (!html) return html;

    // HTML 태그를 플레이스홀더로 치환 (태그 내부 속성 값이 매칭되는 것 방지)
    const tagPlaceholders = [];
    let protectedHtml = html.replace(/<[^>]+>/g, (tag) => {
      const placeholder = `\x00TAG_${tagPlaceholders.length}\x00`;
      tagPlaceholders.push(tag);
      return placeholder;
    });

    // 태그 밖의 텍스트에서만 멘션 하이라이팅
    _MENTION_PATTERN.lastIndex = 0;
    protectedHtml = protectedHtml.replace(_MENTION_PATTERN, '<span class="mention-highlight">@$1</span>');

    // 태그 복원
    return protectedHtml.replace(/\x00TAG_(\d+)\x00/g, (_, i) => tagPlaceholders[Number(i)]);
  }

  /**
   * 답글 수정 모드 시작 (편집 폼을 on-demand로 생성)
   * @param {HTMLElement} replyItem - 답글 DOM 요소
   * @param {string} markerId
   * @param {string} replyId
   * @param {object} config - UI 구성
   * @param {Function} onSaved - 저장 성공 후 콜백 (newText: string) => void
   */
  function startReplyEdit(replyItem, markerId, replyId, config, onSaved) {
    const textEl = replyItem.querySelector(config.textSelector);
    if (!textEl) return;

    // 이미 편집 중이면 무시
    if (replyItem.querySelector('.' + config.formClass)) return;

    const marker = commentManager.getMarker(markerId);
    const reply = marker?.replies?.find(r => r.id === replyId);
    if (!reply) return;

    // 편집 폼 동적 생성
    const form = document.createElement('div');
    form.className = config.formClass;

    let editor;
    if (config.editorType === 'textarea') {
      editor = document.createElement('textarea');
      editor.rows = 2;
      editor.value = reply.text;
    } else {
      editor = document.createElement('div');
      editor.contentEditable = 'true';
      editor.textContent = reply.text;
    }
    editor.className = config.editorClass;

    const actions = document.createElement('div');
    actions.className = config.actionsClass;

    const saveBtn = document.createElement('button');
    saveBtn.className = config.saveClass;
    saveBtn.textContent = '저장';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = config.cancelClass;
    cancelBtn.textContent = '취소';

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(editor);
    form.appendChild(actions);

    // 텍스트 숨기고 폼 삽입
    textEl.style.display = 'none';
    textEl.insertAdjacentElement('afterend', form);

    mentionManager.attach(editor);
    editor.focus();
    resizeReplyEditorToContent(editor);
    editor.addEventListener('input', () => resizeReplyEditorToContent(editor));

    const cleanup = () => {
      mentionManager.detach(editor);
      form.remove();
      textEl.style.display = '';
    };

    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newText = (config.editorType === 'textarea' ? editor.value : editor.innerText).trim();
      if (!newText) return;
      const success = commentManager.updateReply(markerId, replyId, { text: newText });
      if (success) {
        cleanup();
        onSaved(newText);
        showToast('답글이 수정되었습니다.', 'success');
      }
    });

    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cleanup();
    });
  }

  /**
   * 답글 삭제 (확인 후 실행)
   */
  function handleReplyDelete(markerId, replyId, onDeleted) {
    if (!confirm('이 답글을 삭제하시겠습니까?')) return;
    const success = commentManager.deleteReply(markerId, replyId);
    if (success) {
      onDeleted();
      showToast('답글이 삭제되었습니다.', 'success');
    }
  }

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

  function updateCommentList(filter = getActiveCommentFilter()) {
    pendingCommentListFilter = filter;

    // 디바운싱: 연속 호출 시 마지막 호출만 실행 (50ms)
    if (commentListUpdateTimeout) {
      cancelAnimationFrame(commentListUpdateTimeout);
    }
    commentListUpdateTimeout = requestAnimationFrame(() => {
      updateCommentListImmediate(pendingCommentListFilter);
    });
  }

  function playlistRangeMatchesCommentSearch(range, normalizedQuery) {
    if (!normalizedQuery) return true;
    if (markerMatchesCommentSearch(range, normalizedQuery)) return true;

    const haystack = [
      range.fileName,
      range.cutLabel,
      range.localStartTimecode,
      range.globalStartTimecode,
      formatPlaylistCommentPanelLine(range)
    ]
      .filter(value => value !== undefined && value !== null)
      .map(value => String(value).toLowerCase())
      .join(' ');

    return haystack.includes(normalizedQuery);
  }

  function filterPlaylistAggregateCommentRanges(
    ranges,
    filter = getActiveCommentFilter(),
    normalizedSearch = ''
  ) {
    let filtered = Array.isArray(ranges) ? [...ranges] : [];

    if (filter === 'unresolved') {
      filtered = filtered.filter(range => !range.resolved);
    } else if (filter === 'resolved') {
      filtered = filtered.filter(range => range.resolved);
    }

    filtered = filterByAuthors(filtered);

    if (normalizedSearch) {
      filtered = filtered.filter(range => playlistRangeMatchesCommentSearch(range, normalizedSearch));
    }

    return filtered.sort((a, b) => a.globalStartTime - b.globalStartTime);
  }

  function highlightPlaylistAggregateComment(key) {
    const container = elements.commentsList;
    if (!container) return;
    const target = [...container.querySelectorAll('.playlist-aggregate-comment')]
      .find(item => item.dataset.aggregateCommentKey === key);
    if (!target) return;

    container.querySelectorAll('.playlist-aggregate-comment').forEach(item => {
      item.classList.remove('selected', 'glow');
    });
    target.classList.add('selected', 'glow');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => target.classList.remove('glow'), 2600);
  }

  async function openPlaylistAggregateComment(key) {
    const range = playlistAggregateCommentRanges.find(item => getPlaylistAggregateCommentKey(item) === key);
    if (!range) return false;

    const playlistManager = getPlaylistManager();
    const item = playlistManager.getItems().find(candidate => candidate.id === range.itemId);
    if (!item) return false;

    const navigationToken = ++playlistContinuousNavigationToken;
    const isCurrentNavigation = () => (
      navigationToken === playlistContinuousNavigationToken &&
      playlistUIState.mode === 'continuous'
    );
    if (continuousPlaybackState.active) {
      stopContinuousPlayback();
    }

    suppressPlaylistSelectionLoad = true;
    try {
      playlistManager.selectItemById(item.id);
    } finally {
      suppressPlaylistSelectionLoad = false;
    }
    if (!isCurrentNavigation()) return false;

    const isAlreadyLoaded = isSameFilePath(state.currentFile, item.videoPath) &&
      !hasActiveVideoLoadForDifferentFile(item.videoPath);
    if (!isAlreadyLoaded) {
      const loaded = await loadVideoFromPlaylist(item, {
        preserveContinuousSession: true,
        initialFrame: range.localStartFrame || 0,
        revealAfterInitialSeek: true,
        holdPreviousFrameUntilReady: true,
        shouldContinue: isCurrentNavigation
      });
      if (!loaded) return;
      if (!isCurrentNavigation()) return false;
    }

    if (!isCurrentNavigation()) return false;
    videoPlayer.seekToFrame(range.localStartFrame || 0);
    videoPlayer.pause();
    timeline.setCurrentTime(range.globalStartTime || 0);
    updatePlaylistCurrentItem();
    updatePlaylistPosition();
    updateTimecodeDisplay();
    highlightPlaylistAggregateComment(key);
    return true;
  }

  function findMarkerRecordInBframeData(bframeData, markerId, layerId = null) {
    const layers = Array.isArray(bframeData?.comments?.layers) ? bframeData.comments.layers : [];
    for (const layer of layers) {
      if (layerId && layer?.id !== layerId) continue;
      const markers = Array.isArray(layer?.markers) ? layer.markers : [];
      const marker = markers.find(candidate => candidate?.id === markerId && !candidate.deleted);
      if (marker) return marker;
    }
    return null;
  }

  function snapshotMarkerResolution(marker) {
    return {
      resolved: marker?.resolved === true,
      resolvedBy: marker?.resolvedBy || null,
      resolvedAt: marker?.resolvedAt || null,
      updatedAt: marker?.updatedAt || null
    };
  }

  function applyMarkerResolutionToggle(marker) {
    if (!marker) return null;
    const previous = snapshotMarkerResolution(marker);
    marker.resolved = !previous.resolved;
    marker.resolvedAt = marker.resolved ? new Date() : null;
    marker.resolvedBy = marker.resolved ? userName : null;
    marker.updatedAt = new Date();
    return previous;
  }

  function restoreMarkerResolution(marker, previous) {
    if (!marker || !previous) return;
    marker.resolved = previous.resolved;
    marker.resolvedBy = previous.resolvedBy;
    marker.resolvedAt = previous.resolvedAt;
    marker.updatedAt = previous.updatedAt;
  }

  async function togglePlaylistAggregateResolvedWithoutNavigation(range) {
    const playlistManager = getPlaylistManager();
    const item = playlistManager.getItems().find(candidate => candidate.id === range.itemId);
    if (!item) {
      throw new Error('재생목록 항목을 찾을 수 없습니다.');
    }

    const bframePath = await playlistManager.ensureItemBframePath(item);
    if (!bframePath) {
      throw new Error('댓글 파일을 찾을 수 없습니다.');
    }

    const currentBframePath = reviewDataManager.getBframePath();
    if (currentBframePath && isSameFilePath(currentBframePath, bframePath)) {
      const marker = commentManager.getMarker(range.markerId);
      if (!marker || marker.deleted) {
        throw new Error('원본 댓글을 찾을 수 없습니다.');
      }
      const previous = applyMarkerResolutionToggle(marker);
      suppressCommentRangeRefreshOnce = true;
      commentManager._emit('markerUpdated', { marker });
      commentManager._emit('markersChanged');
      const saved = await reviewDataManager.save();
      if (!saved) {
        restoreMarkerResolution(marker, previous);
        suppressCommentRangeRefreshOnce = true;
        commentManager._emit('markerUpdated', { marker });
        commentManager._emit('markersChanged');
        throw new Error('해결 상태 저장에 실패했습니다.');
      }
      return marker;
    }

    const bframeData = await window.electronAPI.loadReview(bframePath);
    const marker = findMarkerRecordInBframeData(bframeData, range.markerId, range.layerId);
    if (!marker) {
      throw new Error('원본 댓글을 찾을 수 없습니다.');
    }

    const dataVersion = getDataVersion(bframeData);
    const unsupportedMajor = getUnsupportedBframeMajor(
      dataVersion,
      BFRAME_VERSION,
      !hasExplicitBframeVersion(bframeData)
    );
    if (unsupportedMajor !== null) {
      throw new Error(`지원하지 않는 .bframe ${dataVersion} 파일은 이 버전에서 저장할 수 없습니다.`);
    }

    ensureReviewDocumentId(bframeData);
    if (!isValidReviewDocumentId(bframeData.reviewDocumentId)) {
      throw new Error('유효하지 않은 reviewDocumentId가 있어 원본 보호를 위해 저장을 중단했습니다.');
    }

    const previous = applyMarkerResolutionToggle(marker);
    try {
      const saved = await window.electronAPI.saveReview(bframePath, bframeData);
      if (saved === false) {
        restoreMarkerResolution(marker, previous);
        throw new Error('해결 상태 저장에 실패했습니다.');
      }
    } catch (error) {
      restoreMarkerResolution(marker, previous);
      throw error;
    }
    return marker;
  }

  function renderPlaylistAggregateReplies(range, normalizedSearch) {
    const replies = range.replies || [];
    if (replies.length === 0) return '';

    return replies.map(reply => {
      const author = reply.author || '익명';
      const imageUrl = reply.image ? escapeHtmlAttribute(reply.image) : '';
      return `
        <div class="playlist-comment-reply" data-reply-id="${escapeHtmlAttribute(reply.id || '')}">
          <div class="playlist-comment-reply-header">
            <span class="comment-reply-author ${getAuthorColorClass(author)}" ${getAuthorColorStyle(author)}>${highlightCommentSearchMatches(author, normalizedSearch)}</span>
            ${reply.createdAt ? `<span class="comment-reply-time">${formatRelativeTime(reply.createdAt)}</span>` : ''}
          </div>
          <p class="comment-reply-text">${reply.text ? highlightMentions(renderGDriveLinks(highlightCommentSearchMatches(reply.text, normalizedSearch))) : ''}</p>
          ${imageUrl ? `<div class="comment-attached-image"><img src="${imageUrl}" alt="첨부 이미지" data-full-image="${imageUrl}"></div>` : ''}
        </div>
      `;
    }).join('');
  }

  async function togglePlaylistAggregateResolved(key) {
    const range = playlistAggregateCommentRanges.find(item => getPlaylistAggregateCommentKey(item) === key);
    if (!range) {
      showToast('해결 상태를 바꿀 댓글을 찾을 수 없습니다.', 'warning');
      return false;
    }

    let marker;
    try {
      marker = await togglePlaylistAggregateResolvedWithoutNavigation(range);
    } catch (error) {
      showToast(error.message || '해결 상태 저장에 실패했습니다.', 'warning');
      return false;
    }

    range.resolved = marker.resolved === true;
    range.resolvedBy = marker.resolvedBy || '';
    range.resolvedAt = marker.resolvedAt || null;

    await refreshCommentRangesForCurrentMode();
    void updatePlaylistUI();
    renderPlaylistContinuousCommentList(commentFilterState.status);
    highlightPlaylistAggregateComment(key);
    showToast(marker.resolved ? '해결됨으로 표시했습니다.' : '미해결로 다시 표시했습니다.', 'success');
    return true;
  }

  async function submitPlaylistAggregateReply(key, textarea) {
    const text = textarea?.value?.trim() || '';
    if (!text) return false;

    const range = playlistAggregateCommentRanges.find(item => getPlaylistAggregateCommentKey(item) === key);
    if (!range) {
      showToast('답글을 달 댓글을 찾을 수 없습니다.', 'warning');
      return false;
    }

    const opened = await openPlaylistAggregateComment(key);
    if (!opened) return false;

    const activeRange = playlistAggregateCommentRanges.find(item => getPlaylistAggregateCommentKey(item) === key) || range;
    const reply = commentManager.addReplyToMarker(activeRange.markerId, text, commentManager.getAuthor());
    if (!reply) {
      showToast('원본 댓글을 찾을 수 없습니다.', 'warning');
      return false;
    }

    activeRange.replies = [...(activeRange.replies || []), reply];
    playlistExpandedReplyKeys.add(key);
    textarea.value = '';
    resizeReplyEditorToContent(textarea);
    renderPlaylistContinuousCommentList(commentFilterState.status);
    highlightPlaylistAggregateComment(key);
    showToast('답글이 추가되었습니다.', 'success');
    return true;
  }

  function renderPlaylistContinuousCommentList(filter = getActiveCommentFilter()) {
    const container = elements.commentsList;
    if (!container) return;

    const savedScrollTop = container.scrollTop;
    const normalizedSearch = normalizeCommentSearch(commentSearchKeyword);
    const authorFilteredRanges = filterByAuthors(playlistAggregateCommentRanges);
    const resolvedCount = authorFilteredRanges.filter(range => range.resolved).length;
    const ranges = filterPlaylistAggregateCommentRanges(
      playlistAggregateCommentRanges,
      filter,
      normalizedSearch
    );

    if (elements.commentCount) {
      if (normalizedSearch) {
        elements.commentCount.textContent = `검색 ${ranges.length} / 전체 ${authorFilteredRanges.length}`;
      } else {
        const unresolvedCount = authorFilteredRanges.length - resolvedCount;
        elements.commentCount.textContent = authorFilteredRanges.length > 0
          ? `${unresolvedCount > 0 ? `${unresolvedCount} 미해결 / ` : ''}${authorFilteredRanges.length}개`
          : '0';
      }
    }

    updateFeedbackProgress(authorFilteredRanges.length, resolvedCount);

    container.querySelectorAll('.playlist-comment-reply-input').forEach(el => {
      mentionManager.detach(el);
    });

    if (ranges.length === 0) {
      const emptyTitle = normalizedSearch ? '검색 결과가 없습니다' : '재생목록 댓글이 없습니다';
      const emptyHint = normalizedSearch
        ? `"${escapeHtml(commentSearchKeyword)}"와 일치하는 재생목록 댓글이 없습니다.`
        : '타임라인 이어붙이기에서는 재생목록 전체 댓글이 이곳에 표시됩니다.';

      container.innerHTML = `
        <div class="comment-empty">
          <span style="font-size: 32px; margin-bottom: 8px;">#</span>
          <p>${emptyTitle}</p>
          <p style="font-size: 11px; color: var(--text-muted);">${emptyHint}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = ranges.map(range => {
      const key = getPlaylistAggregateCommentKey(range);
      const title = escapeHtmlAttribute(formatPlaylistCommentPanelLine(range));
      const author = range.author || '알 수 없음';
      const authorColor = getAuthorColor(range.authorId || author || 'unknown');
      const replyCount = range.replies?.length || 0;
      const repliesExpanded = playlistExpandedReplyKeys.has(key);
      const repliesHtml = renderPlaylistAggregateReplies(range, normalizedSearch);
      const resolveTitle = getResolveButtonLabel(range.resolved, range.resolvedBy);
      const resolveTooltipHtml = range.resolved ? getResolveTooltipHtml(range.resolvedBy, range.resolvedAt) : '';
      const imageUrl = range.image ? escapeHtmlAttribute(range.image) : '';

      return `
      <div class="comment-item playlist-aggregate-comment ${range.resolved ? 'resolved' : ''} ${replyCount > 0 ? 'has-replies' : ''}"
        data-aggregate-comment-key="${escapeHtmlAttribute(key)}"
        data-marker-id="${escapeHtmlAttribute(range.markerId)}"
        data-item-id="${escapeHtmlAttribute(range.itemId)}"
        title="${title}">
        <button type="button" class="comment-resolve-toggle playlist-comment-resolve-toggle" title="${escapeHtmlAttribute(resolveTitle)}" aria-label="${escapeHtmlAttribute(resolveTitle)}">
          ${range.resolved ? '✓ 해결됨' : '○ 미해결'}
          ${resolveTooltipHtml}
        </button>
        <div class="playlist-comment-time-row">
          <span class="comment-timecode">${highlightCommentSearchMatches(range.cutLabel, normalizedSearch)} ${highlightCommentSearchMatches(range.localStartTimecode, normalizedSearch)}</span>
          <span class="playlist-comment-global-time">전체 ${highlightCommentSearchMatches(range.globalStartTimecode, normalizedSearch)}</span>
          <span class="playlist-comment-local-time">컷 ${highlightCommentSearchMatches(range.localStartTimecode, normalizedSearch)}</span>
        </div>
        <div class="comment-content">
          <p class="comment-text">${highlightMentions(renderGDriveLinks(highlightCommentSearchMatches(range.text || '댓글', normalizedSearch)))}</p>
          ${imageUrl ? `<div class="comment-attached-image"><img src="${imageUrl}" alt="첨부 이미지" data-full-image="${imageUrl}"></div>` : ''}
        </div>
        <div class="comment-actions playlist-comment-readonly-actions">
          <span class="comment-author-inline ${getAuthorColorClass(author)}" style="color: ${authorColor.color}; font-weight: bold;">${highlightCommentSearchMatches(author, normalizedSearch)}</span>
          ${range.createdAt ? `<span class="comment-time-inline">${formatRelativeTime(range.createdAt)}</span>` : ''}
          <button type="button" class="comment-action-btn playlist-comment-reply-toggle${repliesExpanded ? ' expanded' : ''}" title="${replyCount > 0 ? '답글 보기/작성' : '답글 작성'}" aria-expanded="${repliesExpanded ? 'true' : 'false'}" data-reply-count="${replyCount}">
            ${replyCount > 0 ? (repliesExpanded ? '답글 접기' : `답글 ${replyCount}개`) : '답글'}
          </button>
          <span class="playlist-comment-source">${highlightCommentSearchMatches(range.fileName, normalizedSearch)}</span>
        </div>
        ${replyCount > 0 ? `<div class="playlist-comment-replies${repliesExpanded ? ' expanded' : ''}" ${repliesExpanded ? '' : 'hidden'}>${repliesHtml}</div>` : ''}
        <div class="playlist-comment-reply-form" ${repliesExpanded ? '' : 'hidden'}>
          <textarea class="playlist-comment-reply-input" placeholder="답글 입력..." rows="1" data-max-auto-height="140"></textarea>
          <button type="button" class="playlist-comment-reply-submit">전송</button>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('.playlist-aggregate-comment').forEach(item => {
      const replyToggle = item.querySelector('.playlist-comment-reply-toggle');
      const replyForm = item.querySelector('.playlist-comment-reply-form');
      const replyInput = item.querySelector('.playlist-comment-reply-input');
      const replies = item.querySelector('.playlist-comment-replies');

      item.addEventListener('click', async (e) => {
        if (e.target.closest('.gdrive-link-btn')) return;
        if (e.target.closest('.playlist-comment-reply-form, .playlist-comment-reply-toggle, .playlist-comment-replies, .playlist-comment-resolve-toggle')) return;
        await openPlaylistAggregateComment(item.dataset.aggregateCommentKey);
      });

      if (replyInput) {
        mentionManager.attach(replyInput);
        resizeReplyEditorToContent(replyInput);
      }

      replyToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!replyForm || !replyInput) return;
        const key = item.dataset.aggregateCommentKey;
        const nextExpanded = !playlistExpandedReplyKeys.has(key);
        if (nextExpanded) {
          playlistExpandedReplyKeys.add(key);
        } else {
          playlistExpandedReplyKeys.delete(key);
        }
        replyForm.hidden = !nextExpanded;
        if (replies) replies.hidden = !nextExpanded;
        replyToggle.classList.toggle('expanded', nextExpanded);
        replyToggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        const replyCount = Number(replyToggle.dataset.replyCount) || 0;
        replyToggle.textContent = replyCount > 0
          ? (nextExpanded ? '답글 접기' : `답글 ${replyCount}개`)
          : '답글';
        if (nextExpanded) {
          replyInput.focus();
          resizeReplyEditorToContent(replyInput);
        }
      });

      item.querySelector('.playlist-comment-resolve-toggle')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const resolveBtn = e.currentTarget;
        resolveBtn.disabled = true;
        try {
          await togglePlaylistAggregateResolved(item.dataset.aggregateCommentKey);
        } finally {
          if (document.contains(resolveBtn)) resolveBtn.disabled = false;
        }
      });

      replyInput?.addEventListener('input', () => resizeReplyEditorToContent(replyInput));

      replyInput?.addEventListener('paste', (e) => {
        handleDrivePathPaste(e);
      });

      item.querySelector('.playlist-comment-reply-submit')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const submitBtn = e.currentTarget;
        submitBtn.disabled = true;
        try {
          await submitPlaylistAggregateReply(item.dataset.aggregateCommentKey, replyInput);
        } finally {
          if (document.contains(submitBtn)) submitBtn.disabled = false;
        }
      });

      replyInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !mentionManager.isVisible) {
          e.preventDefault();
          e.stopPropagation();
          item.querySelector('.playlist-comment-reply-submit')?.click();
        }
      });
    });

    container.scrollTop = savedScrollTop;
  }

  function getCutlistAggregateCommentKey(range) {
    return range.aggregateCommentKey ||
      `${range.cutId || ''}:${range.sourceId || ''}:${range.layerId || ''}:${range.markerId || ''}`;
  }

  function cutlistRangeMatchesCommentSearch(range, normalizedQuery) {
    if (!normalizedQuery) return true;

    const haystack = [
      range.text,
      range.author,
      range.cutLabel,
      range.fileName,
      range.sourceStartFrame,
      range.sourceEndFrame,
      range.localStartTimecode,
      range.globalStartTimecode,
      formatCutlistCommentPanelLine(range)
    ];

    if (Array.isArray(range.replies)) {
      for (const reply of range.replies) {
        haystack.push(reply?.text, reply?.author);
      }
    }

    return haystack
      .filter(value => value !== undefined && value !== null)
      .map(value => String(value).toLowerCase())
      .join(' ')
      .includes(normalizedQuery);
  }

  function filterCutlistAggregateCommentRanges(
    ranges,
    filter = getActiveCommentFilter(),
    normalizedSearch = ''
  ) {
    let filtered = Array.isArray(ranges) ? [...ranges] : [];

    if (filter === 'unresolved') {
      filtered = filtered.filter(range => !range.resolved);
    } else if (filter === 'resolved') {
      filtered = filtered.filter(range => range.resolved);
    }

    filtered = filterByAuthors(filtered);

    if (normalizedSearch) {
      filtered = filtered.filter(range => cutlistRangeMatchesCommentSearch(range, normalizedSearch));
    }

    return filtered.sort((a, b) => a.globalStartTime - b.globalStartTime);
  }

  function highlightCutlistAggregateComment(key) {
    const container = elements.commentsList;
    if (!container) return;
    const target = [...container.querySelectorAll('.cutlist-aggregate-comment')]
      .find(item => item.dataset.cutlistAggregateCommentKey === key);
    if (!target) return;

    container.querySelectorAll('.cutlist-aggregate-comment').forEach(item => {
      item.classList.remove('selected', 'glow');
    });
    target.classList.add('selected', 'glow');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => target.classList.remove('glow'), 2600);
  }

  async function openCutlistAggregateComment(key) {
    const range = cutlistAggregateCommentRanges.find(item => getCutlistAggregateCommentKey(item) === key);
    if (!range) return;

    const cutlistManager = getCutlistManager();
    const cut = cutlistManager.getCutById(range.cutId);
    if (!cut) return;

    const segment = getCutlistSegmentForCut(cut);
    if (!segment) return;

    const fps = Math.max(1, Number(range.fps || segment.fps || cut.fps) || 24);
    const sourceStartFrame = Number(segment.sourceStartFrame ?? cut.startFrame) || 0;
    const sourceFrame = Math.max(
      0,
      Number(range.sourceStartFrame ?? (sourceStartFrame + Number(range.localStartFrame || 0))) || 0
    );
    const localTime = Math.max(0, sourceFrame - sourceStartFrame) / fps;
    const moved = await seekCutlistMappedPosition({
      segment,
      sourceFrame,
      localTime
    });
    if (!moved) return;

    videoPlayer.pause();
    timeline.setCurrentTime(Number(range.globalStartTime) || segment.globalStartTime || 0);
    updateTimecodeDisplay();
    highlightCutlistAggregateComment(key);
  }

  function renderCutlistAggregateCommentList(filter = getActiveCommentFilter()) {
    const container = elements.commentsList;
    if (!container) return;

    const savedScrollTop = container.scrollTop;
    const normalizedSearch = normalizeCommentSearch(commentSearchKeyword);
    const authorFilteredRanges = filterByAuthors(cutlistAggregateCommentRanges);
    const resolvedCount = authorFilteredRanges.filter(range => range.resolved).length;
    const ranges = filterCutlistAggregateCommentRanges(
      cutlistAggregateCommentRanges,
      filter,
      normalizedSearch
    );

    if (elements.commentCount) {
      if (normalizedSearch) {
        elements.commentCount.textContent = `검색 ${ranges.length} / 전체 ${authorFilteredRanges.length}`;
      } else {
        const unresolvedCount = authorFilteredRanges.length - resolvedCount;
        elements.commentCount.textContent = authorFilteredRanges.length > 0
          ? `${unresolvedCount > 0 ? `${unresolvedCount} 미해결 / ` : ''}${authorFilteredRanges.length}개`
          : '0';
      }
    }

    updateFeedbackProgress(authorFilteredRanges.length, resolvedCount);

    if (ranges.length === 0) {
      const emptyTitle = normalizedSearch ? '검색 결과가 없습니다' : '컷 묶음 댓글이 없습니다';
      const emptyHint = normalizedSearch
        ? `"${escapeHtml(commentSearchKeyword)}"와 일치하는 컷 묶음 댓글이 없습니다.`
        : '컷 묶음 모드에서는 연결된 모든 원본의 댓글이 이곳에 표시됩니다.';

      container.innerHTML = `
        <div class="comment-empty">
          <span style="font-size: 32px; margin-bottom: 8px;">#</span>
          <p>${emptyTitle}</p>
          <p style="font-size: 11px; color: var(--text-muted);">${emptyHint}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = ranges.map(range => {
      const key = getCutlistAggregateCommentKey(range);
      const title = escapeHtmlAttribute(formatCutlistCommentPanelLine(range));
      const author = range.author || '알 수 없음';
      const authorColor = getAuthorColor(range.authorId || author || 'unknown');
      const replyCount = range.replies?.length || 0;

      return `
      <div class="comment-item cutlist-aggregate-comment playlist-aggregate-comment ${range.resolved ? 'resolved' : ''}"
        data-cutlist-aggregate-comment-key="${escapeHtml(key)}"
        data-marker-id="${escapeHtml(range.markerId)}"
        data-cut-id="${escapeHtml(range.cutId)}"
        data-source-id="${escapeHtml(range.sourceId)}"
        title="${title}">
        <div class="playlist-comment-time-row">
          <span class="comment-timecode">${highlightCommentSearchMatches(range.cutLabel, normalizedSearch)} ${highlightCommentSearchMatches(range.localStartTimecode, normalizedSearch)}</span>
          <span class="playlist-comment-global-time">전체 ${highlightCommentSearchMatches(range.globalStartTimecode, normalizedSearch)}</span>
          <span class="playlist-comment-local-time">컷 ${highlightCommentSearchMatches(range.localStartTimecode, normalizedSearch)}</span>
        </div>
        <div class="comment-content">
          <p class="comment-text">${highlightMentions(renderGDriveLinks(highlightCommentSearchMatches(range.text || '댓글', normalizedSearch)))}</p>
          ${range.image ? `<div class="comment-attached-image"><img src="${range.image}" alt="첨부 이미지" data-full-image="${range.image}"></div>` : ''}
        </div>
        <div class="comment-actions playlist-comment-readonly-actions">
          <span class="comment-author-inline ${getAuthorColorClass(author)}" style="color: ${authorColor.color}; font-weight: bold;">${highlightCommentSearchMatches(author, normalizedSearch)}</span>
          ${range.createdAt ? `<span class="comment-time-inline">${formatRelativeTime(range.createdAt)}</span>` : ''}
          ${replyCount > 0 ? `<span class="playlist-comment-reply-count">답글 ${replyCount}개</span>` : ''}
          <span class="playlist-comment-source">${highlightCommentSearchMatches(range.fileName, normalizedSearch)}</span>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('.cutlist-aggregate-comment').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.gdrive-link-btn')) return;
        await openCutlistAggregateComment(item.dataset.cutlistAggregateCommentKey);
      });
    });

    container.scrollTop = savedScrollTop;
  }

  // 피드백 36: 이전 버전 댓글을 읽기 전용 고스트 섹션으로 목록 하단에 덧붙인다.
  function appendPreviousVersionCommentSection(container) {
    if (!previousVersionComments || !container) return;
    const { label, comments } = previousVersionComments;
    const currentFps = Number(videoPlayer.fps) > 0 ? Number(videoPlayer.fps) : 24;
    const itemsHtml = comments.map((marker) => {
      const sourceFps = Number(marker.fps) > 0 ? Number(marker.fps) : 24;
      const seconds = Number(marker.startFrame || 0) / sourceFps;
      const targetFrame = Math.max(0, Math.round(seconds * currentFps));
      const timecode = formatTimecode(seconds, currentFps);
      return `
        <div class="comment-ghost-item" data-ghost-frame="${targetFrame}">
          <div class="comment-ghost-item-header">
            <span class="comment-ghost-time">${timecode}</span>
            <span class="comment-ghost-author">${escapeHtml(marker.author || '')}</span>
          </div>
          <div class="comment-ghost-text">${escapeHtml(marker.text || '')}</div>
        </div>`;
    }).join('');
    container.insertAdjacentHTML('beforeend', `
      <div class="comment-ghost-section">
        <div class="comment-ghost-section-title">${escapeHtml(label)}의 댓글 (읽기 전용 · ${comments.length}개)</div>
        ${itemsHtml}
      </div>`);
    container.querySelectorAll('.comment-ghost-item').forEach((item) => {
      item.addEventListener('click', () => {
        const frame = Number(item.dataset.ghostFrame);
        if (Number.isFinite(frame)) videoPlayer.seekToFrame(frame);
      });
    });
  }

  function updateCommentListImmediate(filter = getActiveCommentFilter()) {
    const container = elements.commentsList;
    if (!container) return;

    if (playlistUIState.mode === 'continuous') {
      renderPlaylistContinuousCommentList(filter);
      return;
    }

    if (cutlistUIState.active) {
      renderCutlistAggregateCommentList(filter);
      return;
    }

    // 확장 상태 및 스크롤 위치 보존
    const expandedIds = new Set(
      [...container.querySelectorAll('.comment-thread-toggle.expanded')]
        .map(el => el.dataset.markerId)
    );
    const savedScrollTop = container.scrollTop;

    let markers = commentManager.getAllMarkers();

    // 필터 적용
    if (filter === 'unresolved') {
      markers = markers.filter(m => !m.resolved);
    } else if (filter === 'resolved') {
      markers = markers.filter(m => m.resolved);
    }

    // 작성자 필터 적용
    markers = filterByAuthors(markers);

    const normalizedSearch = normalizeCommentSearch(commentSearchKeyword);
    if (normalizedSearch) {
      markers = markers.filter((marker) => markerMatchesCommentSearch(marker, normalizedSearch));
    }

    // 개수 업데이트
    const allMarkers = commentManager.getAllMarkers();
    const unresolvedCount = allMarkers.filter(m => !m.resolved).length;
    const resolvedCount = allMarkers.filter(m => m.resolved).length;
    if (elements.commentCount) {
      if (normalizedSearch) {
        elements.commentCount.textContent = `검색 ${markers.length} / 전체 ${allMarkers.length}`;
      } else {
        elements.commentCount.textContent = allMarkers.length > 0
          ? `${unresolvedCount > 0 ? `${unresolvedCount} 미해결 / ` : ''}${allMarkers.length}개`
          : '0';
      }
    }

    // 피드백 완료율 업데이트
    updateFeedbackProgress(allMarkers.length, resolvedCount);

    if (markers.length === 0) {
      const emptyTitle = normalizedSearch ? '검색 결과가 없습니다' : '댓글이 없습니다';
      const emptyHint = normalizedSearch
        ? `"${escapeHtml(commentSearchKeyword)}"와 일치하는 댓글이 없습니다.`
        : 'C 키를 눌러 영상 위에 댓글을 추가하세요.';

      container.innerHTML = `
        <div class="comment-empty">
          <span style="font-size: 32px; margin-bottom: 8px;">#</span>
          <p>${emptyTitle}</p>
          <p style="font-size: 11px; color: var(--text-muted);">${emptyHint}</p>
        </div>
      `;
      appendPreviousVersionCommentSection(container);
      return;
    }

    // 가상 스크롤 상태 저장
    virtualScrollState.filteredMarkers = markers;
    virtualScrollState.currentFilter = filter;
    virtualScrollState.currentSearch = normalizedSearch;

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

    // 재렌더링 전: 기존 요소들의 mentionManager 핸들러 정리 (메모리 누수 방지)
    container.querySelectorAll('.comment-reply-input, .comment-reply-edit-textarea, .comment-edit-textarea').forEach(el => {
      mentionManager.detach(el);
    });

    container.innerHTML = markers.map(marker => {
      const authorClass = getAuthorColorClass(marker.author);
      const authorStyle = getAuthorColorStyle(marker.author);
      const markerAuthorColor = getAuthorColor(marker.authorId || marker.author || 'unknown');
      const replyCount = marker.replies?.length || 0;
      const avatarImage = userSettings.getAvatarForName(marker.author);
      const cutlistCommentLabel = getCutlistCommentLabelForMarker(marker);
      const commentTimeLabel = cutlistCommentLabel || marker.startTimecode;
      const commentPanelLine = getCutlistCommentPanelLineForMarker(marker);
      const resolveTitle = getResolveButtonLabel(marker.resolved, marker.resolvedBy);
      const resolveTooltipHtml = marker.resolved ? getResolveTooltipHtml(marker.resolvedBy, marker.resolvedAt) : '';
      const repliesHtml = (marker.replies || []).map(reply => {
        const canEditReply = commentManager.canEdit(reply);
        return `
        <div class="comment-reply" data-reply-id="${reply.id}" data-marker-id="${marker.id}">
          <div class="comment-reply-header">
            <span class="comment-reply-author ${getAuthorColorClass(reply.author)}" ${getAuthorColorStyle(reply.author)}>${highlightCommentSearchMatches(reply.author, normalizedSearch)}</span>
            <span class="comment-reply-time">${formatRelativeTime(reply.createdAt)}</span>
            ${canEditReply ? `
            <div class="comment-reply-actions">
              <button class="comment-reply-action-btn comment-reply-edit-btn" title="수정">수정</button>
              <button class="comment-reply-action-btn comment-reply-delete-btn" title="삭제">삭제</button>
            </div>
            ` : ''}
          </div>
          <p class="comment-reply-text">${reply.text ? highlightMentions(renderGDriveLinks(highlightCommentSearchMatches(reply.text, normalizedSearch))) : ''}</p>
          ${reply.image ? `<div class="comment-attached-image"><img src="${reply.image}" alt="첨부 이미지" data-full-image="${reply.image}"></div>` : ''}
        </div>
      `;
      }).join('');

      // 썸네일 URL 가져오기 — 정확 프레임 우선, 없으면 근사치 + 온디맨드 캡처 요청
      const markerTime = marker.startFrame / videoPlayer.fps;
      let thumbnailUrl = null;
      if (showThumbnails && thumbnailGenerator?.isReady) {
        thumbnailUrl = thumbnailGenerator.getThumbnailUrlAtExact(markerTime);
        if (!thumbnailUrl) {
          thumbnailGenerator.requestExactCapture(markerTime);
          thumbnailUrl = thumbnailGenerator.getThumbnailUrlAt(markerTime);
        }
      }

      const thumbnailHtml = thumbnailUrl ? `
        <div class="comment-thumbnail-wrapper" style="max-width: ${thumbnailScale}%;">
          <img class="comment-thumbnail" src="${thumbnailUrl}" alt="Frame ${marker.startFrame}">
          <div class="comment-thumbnail-overlay">
            <div class="thumbnail-play-icon">
              <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
            <span class="thumbnail-timecode">${highlightCommentSearchMatches(marker.startTimecode, normalizedSearch)}</span>
          </div>
        </div>
      ` : '';

      return `
      <div class="comment-item ${marker.resolved ? 'resolved' : ''} ${avatarImage ? 'has-avatar' : ''} ${thumbnailUrl ? 'has-thumbnail' : ''} ${marker.image ? 'has-image' : ''}" data-marker-id="${marker.id}" data-start-frame="${marker.startFrame}"${commentPanelLine ? ` title="${escapeHtmlAttribute(commentPanelLine)}"` : ''}>
        ${avatarImage ? `<div class="comment-avatar-bg" style="background-image: url('${avatarImage}')"></div>` : ''}
        <button class="comment-resolve-toggle resolve-btn" title="${escapeHtmlAttribute(resolveTitle)}" aria-label="${escapeHtmlAttribute(resolveTitle)}">
          ${marker.resolved ? '✓ 해결됨' : '○ 미해결'}
          ${resolveTooltipHtml}
        </button>
        ${thumbnailHtml}
        <div class="comment-header">
          <span class="comment-timecode">${highlightCommentSearchMatches(commentTimeLabel, normalizedSearch)}</span>
        </div>
        <div class="comment-content">
          <p class="comment-text">${highlightMentions(renderGDriveLinks(highlightCommentSearchMatches(marker.text, normalizedSearch)))}</p>
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
          <span class="comment-author-inline ${authorClass}" style="color: ${markerAuthorColor.color}; font-weight: bold;">${highlightCommentSearchMatches(marker.author, normalizedSearch)}</span>
          <span class="comment-time-inline">${formatRelativeTime(marker.createdAt)}</span>
          <button class="comment-action-btn edit-btn" title="수정">수정</button>
          <button class="comment-action-btn reply-btn" title="답글">답글</button>
          <button class="comment-action-btn delete-btn" title="삭제">삭제</button>
        </div>
        ${replyCount > 0 ? `
        <button class="comment-thread-toggle${expandedIds.has(marker.id) ? ' expanded' : ''}" data-marker-id="${marker.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          답글 ${replyCount}개
        </button>
        ` : ''}
        <div class="comment-replies${expandedIds.has(marker.id) ? ' expanded' : ''}" data-marker-id="${marker.id}">
          ${repliesHtml}
          <div class="comment-reply-image-preview" style="display: none;">
            <img class="comment-reply-preview-img" src="" alt="첨부 이미지">
            <button class="comment-reply-image-remove" title="이미지 제거">✕</button>
          </div>
          <div class="comment-reply-input-wrapper">
            <textarea class="comment-reply-input" placeholder="답글 입력... (Ctrl+V로 이미지 붙여넣기)" rows="1"></textarea>
            <div class="comment-reply-input-actions">
              <button class="comment-reply-image-btn" title="이미지 첨부">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </button>
              <button class="comment-reply-submit">전송</button>
            </div>
          </div>
        </div>
      </div>
    `;
    }).join('');

    appendPreviousVersionCommentSection(container);

    // 이벤트 바인딩
    container.querySelectorAll('.comment-item').forEach(item => {
      // 클릭으로 해당 프레임 이동
      item.addEventListener('click', (e) => {
        if (e.target.closest('.comment-action-btn')) return;
        if (e.target.closest('.gdrive-link-btn')) return;
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
        commentManager.toggleMarkerResolved(item.dataset.markerId, userName);
      });

      // 삭제 버튼
      item.querySelector('.delete-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();

        // 권한 체크 (본인 코멘트만 삭제 가능)
        const markerToDelete = commentManager.getMarker(item.dataset.markerId);
        if (markerToDelete && !commentManager.canEdit(markerToDelete)) {
          showToast('본인 코멘트만 삭제할 수 있습니다.', 'warning');
          return;
        }

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

            // Undo 스택에 추가 (save 전에 호출하여 시간순 보장)
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

            // 삭제 상태 저장 (협업 동기화용)
            await reviewDataManager.save();

            showToast('댓글이 삭제되었습니다.', 'info');
          }
        }
      });

      // 수정 버튼
      const editBtn = item.querySelector('.edit-btn');
      const contentEl = item.querySelector('.comment-content');
      const editFormEl = item.querySelector('.comment-edit-form');
      const editTextarea = item.querySelector('.comment-edit-textarea');
      if (editTextarea) mentionManager.attach(editTextarea);
      const actionsEl = item.querySelector('.comment-actions');

      editBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const markerId = item.dataset.markerId;

        // 권한 체크 (본인 코멘트만 수정 가능)
        const markerToEdit = commentManager.getMarker(markerId);
        if (markerToEdit && !commentManager.canEdit(markerToEdit)) {
          showToast('본인 코멘트만 수정할 수 있습니다.', 'warning');
          return;
        }

        // Presence 기반 편집 잠금 확인
        const lockCheck = liveblocksManager.checkEditLock(markerId);
        if (lockCheck.isLocked) {
          showToast(`${lockCheck.lockedBy}님이 수정 중입니다`, 'warn');
          return;
        }
        liveblocksManager.updatePresence({ activeComment: markerId });

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
            const updated = commentManager.updateMarker(markerId, { text: newText });

            // 권한 없음 시 중단
            if (!updated) {
              showToast('본인 코멘트만 수정할 수 있습니다.', 'warning');
              // 편집 잠금 해제
              liveblocksManager.updatePresence({ activeComment: null });
              return;
            }

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
        liveblocksManager.updatePresence({ activeComment: null });
      });

      // 수정 취소
      item.querySelector('.comment-edit-cancel')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const markerId = item.dataset.markerId;

        // 편집 잠금 해제
        liveblocksManager.updatePresence({ activeComment: null });

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
        // 멘션 드롭다운 열림 중에는 멘션 매니저가 키를 처리
        if (e.__mentionHandled || mentionManager.isVisible) return;

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
      const replyImageBtn = item.querySelector('.comment-reply-image-btn');
      const replyImagePreview = item.querySelector('.comment-reply-image-preview');
      const replyPreviewImg = item.querySelector('.comment-reply-preview-img');
      const replyImageRemove = item.querySelector('.comment-reply-image-remove');

      // 인라인 답글 이미지 상태
      let pendingReplyImage = null;

      function showReplyImagePreview(imageData) {
        pendingReplyImage = imageData;
        replyPreviewImg.src = imageData.base64;
        replyImagePreview.style.display = 'block';
      }

      function clearReplyImage() {
        pendingReplyImage = null;
        if (replyPreviewImg) replyPreviewImg.src = '';
        if (replyImagePreview) replyImagePreview.style.display = 'none';
      }

      // 인라인 답글 textarea에 멘션 자동완성 부착
      if (replyInput) mentionManager.attach(replyInput);
      resizeReplyEditorToContent(replyInput);
      replyInput?.addEventListener('input', () => resizeReplyEditorToContent(replyInput));

      // 답글 이미지 버튼 클릭
      replyImageBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const imageData = await selectImageFile();
        if (imageData) {
          showReplyImagePreview(imageData);
          showToast('이미지가 첨부되었습니다', 'success');
        }
      });

      // 답글 이미지 제거
      replyImageRemove?.addEventListener('click', (e) => {
        e.stopPropagation();
        clearReplyImage();
      });

      // 답글 이미지 붙여넣기
      // 주의: async 핸들러의 await 이후 preventDefault는 이미 늦어서 무효함
      //       → 이미지 유무를 먼저 동기 체크 후 즉시 preventDefault
      replyInput?.addEventListener('paste', async (e) => {
        if (!hasImageInClipboard(e)) return;
        e.preventDefault();
        const imageData = await getImageFromClipboard(e);
        if (imageData) {
          showReplyImagePreview(imageData);
          showToast('이미지가 첨부되었습니다', 'success');
        }
      });

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
        resizeReplyEditorToContent(replyInput);
      });

      // 답글 제출 (이미지 포함)
      replySubmit?.addEventListener('click', (e) => {
        e.stopPropagation();
        const replyText = replyInput.value.trim();
        const hasImage = pendingReplyImage && pendingReplyImage.base64;
        if (!replyText && !hasImage) return;

        const marker = commentManager.getMarker(item.dataset.markerId);
        if (!marker) return;

        const replyData = {
          text: replyText || '',
          author: commentManager.getAuthor()
        };
        if (hasImage) {
          replyData.image = pendingReplyImage.base64;
          replyData.imageWidth = pendingReplyImage.width;
          replyData.imageHeight = pendingReplyImage.height;
        }

        const newReply = marker.addReply(replyData);
        commentManager._emit('replyAdded', { marker, reply: newReply });
        commentManager._emit('markersChanged');

        replyInput.value = '';
        resizeReplyEditorToContent(replyInput);
        clearReplyImage();
        showToast('답글이 추가되었습니다.', 'success');
      });

      // Enter로 답글 제출
      replyInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !mentionManager.isVisible) {
          e.preventDefault();
          e.stopPropagation();
          replySubmit?.click();
        }
      });

      // 답글 수정/삭제 이벤트 바인딩 (공통 헬퍼 사용)
      const inlineEditConfig = {
        textSelector: '.comment-reply-text',
        editorType: 'textarea',
        editorClass: 'comment-reply-edit-textarea',
        formClass: 'comment-reply-edit-form',
        actionsClass: 'comment-reply-edit-actions',
        saveClass: 'comment-reply-edit-save',
        cancelClass: 'comment-reply-edit-cancel'
      };

      item.querySelectorAll('.comment-reply').forEach(replyEl => {
        const replyId = replyEl.dataset.replyId;
        const markerId = replyEl.dataset.markerId;
        if (!replyId) return;

        replyEl.querySelector('.comment-reply-edit-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          startReplyEdit(replyEl, markerId, replyId, inlineEditConfig, () => {
            // commentManager가 markersChanged 이벤트를 발생시켜
            // 댓글 목록이 자동 재렌더링되므로 별도 호출 불필요
          });
        });

        replyEl.querySelector('.comment-reply-delete-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          handleReplyDelete(markerId, replyId, () => {
            // markersChanged 이벤트로 자동 재렌더링
          });
        });
      });
    });

    // 스크롤 위치 복원
    container.scrollTop = savedScrollTop;
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
      }, 2500);
    }
  }

  // 댓글 목록이 렌더링될 때마다 pendingCommentFocus 체크
  commentManager.addEventListener('markersChanged', () => {
    if (state.pendingCommentFocus) {
      const commentId = state.pendingCommentFocus;
      const marker = commentManager.getMarker(commentId);
      if (marker) {
        state.pendingCommentFocus = null;
        log.info('pendingCommentFocus 감지, 포커싱 실행', { commentId });
        // 댓글 목록 렌더링 후 포커싱
        setTimeout(() => {
          updateCommentList();
          setTimeout(() => focusComment(commentId), 300);
        }, 200);
      }
    }
  });

  /**
   * Slack 딥링크에서 특정 코멘트로 포커싱
   * - 댓글 패널 열기
   * - 해당 코멘트로 스크롤 + 선택
   * - 해당 프레임으로 이동
   */
  function focusComment(markerId) {
    log.info('코멘트 포커싱', { markerId });

    const marker = commentManager.getMarker(markerId);
    if (!marker) {
      log.warn('포커싱할 코멘트를 찾을 수 없음', { markerId });
      showToast('해당 코멘트를 찾을 수 없습니다', 'warning');
      return;
    }

    // 해당 프레임으로 이동
    videoPlayer.seekToFrame(marker.startFrame);

    // 기존 글로우 함수 재사용 (패널 열기 + 스크롤 + 선택 + 글로우)
    scrollToCommentWithGlow(markerId);
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
   * paste 이벤트에서 드라이브 경로를 감지하여 첫 줄에 따옴표를 감싸는 헬퍼.
   * 이미지 paste가 아닌 텍스트 paste에서만 동작.
   * @returns {boolean} 경로가 감지되어 처리된 경우 true
   */
  function handleDrivePathPaste(e) {
    // 이미지 데이터가 있으면 무시 (기존 이미지 paste 우선)
    if (e.clipboardData?.files?.length > 0) return false;
    if (e.clipboardData?.types?.includes('image/png')) return false;

    const text = e.clipboardData?.getData('text');
    if (!text) return false;

    const trimmed = text.trim();
    // 드라이브 경로 패턴: C:\ D:\ G:/ 등
    if (!/^[A-Z]:[/\\]/i.test(trimmed)) return false;

    // 이미 따옴표로 감싸져 있으면 무시
    if (/^["']/.test(trimmed) && /["']$/.test(trimmed)) return false;

    e.preventDefault();

    const target = e.target;
    const lines = text.split('\n');
    // 첫 줄(경로)만 따옴표 감싸기, 나머지 줄은 그대로
    lines[0] = `"${lines[0].trim()}"`;
    const result = lines.join('\n');

    // textarea/input에 삽입
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const value = target.value;
    target.value = value.slice(0, start) + result + value.slice(end);
    target.selectionStart = target.selectionEnd = start + result.length;

    // input 이벤트 트리거 (auto-resize 등)
    target.dispatchEvent(new Event('input', { bubbles: true }));

    return true;
  }

  /**
   * G:/ 드라이브 경로를 클릭 가능한 버튼으로 변환
   * escapeHtml 처리된 문자열에서 동작
   */
  function renderGDriveLinks(html) {
    if (!html) return html;
    const TAG_RE = /<\/?mark[^>]*>/gi;

    // 버튼 HTML 생성 헬퍼
    function makeBtn(displayHtml, rawPath) {
      const cleanPath = rawPath.replace(TAG_RE, '').replace(/\//g, '\\');
      return `<button class="gdrive-link-btn" data-path="${escapeHtml(cleanPath)}" title="${escapeHtml(cleanPath)}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${displayHtml}</button>`;
    }

    // 1단계: 따옴표로 감싼 경로 (공백/한글 자유롭게 포함)
    //   플레이스홀더로 교체하여 2단계에서 재매칭 방지
    const placeholders = [];
    html = html.replace(/(?:&quot;|&amp;quot;|"|&#39;|')\s*(G:[/\\](?:[^<"'&]|&[^q#]|&q[^u]|&#[^3]|<\/?mark[^>]*>)*?)(?:\s*(?:&quot;|&amp;quot;|"|&#39;|'))/gi, (match, path) => {
      const placeholder = `\x00GDRIVE_${placeholders.length}\x00`;
      placeholders.push(makeBtn(path, path));
      return placeholder;
    });

    // 2단계: 따옴표 없는 경로
    //   2a: 파일 확장자로 끝나는 경우 — 공백 허용 (확장자까지만 매칭)
    //   영상/이미지/작업파일 확장자: mov, mp4, avi, mkv, psd, exr, png, jpg, jpeg, tif, tiff, bmp, gif,
    //                              ae, aep, prproj, blend, ma, mb, fbx, obj, abc, hip, nk, bframe, pdf, zip
    const FILE_EXT_RE = /\.(mov|mp4|avi|mkv|wmv|mxf|psd|exr|dpx|png|jpe?g|tiff?|bmp|gif|svg|ae[pt]?|prproj|blend|ma|mb|fbx|obj|abc|hip|nk|bframe|pdf|zip|rar|7z|wav|mp3|aif)/i;
    html = html.replace(/(G:[/\\](?:[^<"'&\x00]|&[^q#]|&q[^u]|&#[^3]|<\/?mark[^>]*>)*?\.(?:mov|mp4|avi|mkv|wmv|mxf|psd|exr|dpx|png|jpe?g|tiff?|bmp|gif|svg|ae[pt]?|prproj|blend|ma|mb|fbx|obj|abc|hip|nk|bframe|pdf|zip|rar|7z|wav|mp3|aif))/gi, (match) => {
      return makeBtn(match, match);
    });

    //   2b: 확장자 없는 경로 (폴더) — 공백 불허
    //   <mark> 태그는 허용 (검색 하이라이트)
    html = html.replace(/(G:[/\\](?:[^\n\r<"'&\x00]|&[^q#]|&q[^u]|&#[^3]|<\/?mark[^>]*>)+)/gi, (match) => {
      if (match.includes('gdrive-link-btn')) return match;
      const trimmed = match.replace(/\s+$/, '');
      return makeBtn(trimmed, trimmed);
    });

    // 3단계: 플레이스홀더를 실제 버튼으로 복원
    placeholders.forEach((btn, i) => {
      html = html.replace(`\x00GDRIVE_${i}\x00`, btn);
    });

    return html;
  }

  /**
   * 해결됨 날짜/시간 포맷 (예: 2월 9일 3:30 PM)
   */
  function formatResolvedDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${month}월 ${day}일 ${hours}:${minutes} ${ampm}`;
  }

  function getResolveButtonLabel(isResolved, resolvedBy) {
    if (!isResolved) return '해결됨으로 변경';

    const resolver = typeof resolvedBy === 'string' ? resolvedBy.trim() : resolvedBy;
    return resolver
      ? `${resolver}님이 해결함 - 미해결로 변경`
      : '해결한 사람 기록 없음 - 미해결로 변경';
  }

  function getResolveTooltipHtml(resolvedBy, resolvedAt) {
    const resolver = typeof resolvedBy === 'string' ? resolvedBy.trim() : resolvedBy;
    const resolverText = resolver ? `해결됨 by ${escapeHtml(resolver)}` : '해결한 사람 기록 없음';
    const resolvedDateText = formatResolvedDate(resolvedAt);

    return `
      <span class="resolve-tooltip">
        <span class="resolve-tooltip-who">${resolverText}</span>
        ${resolvedDateText ? `<span class="resolve-tooltip-date">${resolvedDateText}</span>` : ''}
      </span>
    `;
  }

  /**
   * HTML 이스케이프
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeHtmlAttribute(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * 비디오 파일 확인
   */
  function isVideoFile(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    return SUPPORTED_VIDEO_EXTENSIONS.includes(ext);
  }

  function isAlphaPreservingCompositionMedia(filePath) {
    const ext = String(filePath || '').toLowerCase().split('.').pop();
    return ALPHA_PRESERVING_COMPOSITION_EXTENSIONS.includes(ext);
  }

  /**
   * 오디오 파일 확인
   */
  function isAudioFile(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    return SUPPORTED_AUDIO_EXTENSIONS.includes(ext);
  }

  /**
   * 미디어 파일 확인 (비디오 + 오디오)
   */
  function isMediaFile(filename) {
    return isVideoFile(filename) || isAudioFile(filename);
  }

  function isCompositionLayerFile(filename) {
    const ext = String(filename || '').toLowerCase().split('.').pop();
    return SUPPORTED_COMPOSITION_EXTENSIONS.includes(ext);
  }

  /**
   * 토스트 알림 시스템 (Sonner-style)
   */
  const _toastState = {
    toasts: [],     // 현재 활성 토스트 요소 배열
    maxVisible: 3,  // 최대 표시 개수
    isHovered: false
  };

  const _toastIcons = {
    info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    success: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11.5 14.5 16 10"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    warning: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    loading: '<svg class="toast-spinner" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4"/><path d="M12 18v4" opacity=".3"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83" opacity=".3"/><path d="M2 12h4" opacity=".7"/><path d="M18 12h4" opacity=".3"/><path d="M4.93 19.07l2.83-2.83" opacity=".5"/><path d="M16.24 7.76l2.83-2.83" opacity=".7"/></svg>'
  };

  function _updateToastStack() {
    const layout = computeToastStackLayout(_toastState.toasts, {
      maxVisible: _toastState.maxVisible
    });

    layout.forEach((entry) => {
      const toast = _toastState.toasts[entry.index];
      if (!toast) return;

      toast.style.zIndex = String(entry.zIndex);
      toast.classList.toggle('toast-stacked', entry.stacked);
      toast.classList.toggle('toast-hidden', entry.hidden);
      toast.style.setProperty('--stack-scale', entry.scale);
      toast.style.setProperty('--stack-opacity', entry.opacity);
      toast.style.setProperty('--stack-brightness', entry.brightness);
    });

    scheduleMpvOverlayStateSync({ force: true });
  }

  function _dismissToast(toast, swipeDir) {
    if (toast._dismissed) return;
    toast._dismissed = true;
    toast.style.zIndex = '0';
    clearTimeout(toast._autoTimer);
    cancelAnimationFrame(toast._progressRaf);

    // 1단계: 페이드아웃 (opacity + transform)
    toast.style.pointerEvents = 'none';
    if (swipeDir) {
      toast.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
      toast.style.transform = `translateX(${swipeDir > 0 ? '120%' : '-120%'})`;
      toast.style.opacity = '0';
    } else {
      toast.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      toast.style.transform = 'translateY(-8px) scale(0.96)';
      toast.style.opacity = '0';
    }
    scheduleMpvOverlayStateSync({ force: true });

    // 2단계: 페이드아웃 완료 후 공간 축소 (Sonner 방식)
    const fadeTime = swipeDir ? 250 : 200;
    setTimeout(() => {
      // 현재 높이를 고정한 뒤 0으로 transition
      const h = toast.offsetHeight;
      toast.style.height = h + 'px';
      toast.style.overflow = 'hidden';
      // force reflow
      void toast.offsetHeight;
      toast.style.transition = 'height 0.2s ease-out, margin 0.2s ease-out, padding 0.2s ease-out';
      toast.style.height = '0';
      toast.style.marginBottom = '0';
      toast.style.marginTop = '0';
      toast.style.paddingTop = '0';
      toast.style.paddingBottom = '0';
      toast.style.borderWidth = '0';

      // 배열에서 제거 + 스택 재정렬
      const idx = _toastState.toasts.indexOf(toast);
      if (idx !== -1) _toastState.toasts.splice(idx, 1);
      _updateToastStack();

      // 공간 축소 완료 후 DOM 제거
      setTimeout(() => {
        toast.remove();
        scheduleMpvOverlayStateSync({ force: true });
      }, 220);
    }, fadeTime);
  }

  function _isToastContainerHovered() {
    if (!elements.toastContainer) return false;
    try {
      return _toastState.isHovered || elements.toastContainer.matches(':hover');
    } catch {
      return _toastState.isHovered;
    }
  }

  function _startToastProgress(toast) {
    if (!toast || !toast._progress || toast._isLoading || toast._paused || toast._dismissed) return;
    cancelAnimationFrame(toast._progressRaf);
    toast._progressRaf = requestAnimationFrame(function tick() {
      if (toast._isLoading || toast._dismissed) return;
      if (toast._paused) return;
      const elapsed = performance.now() - toast._startedAt;
      const pct = Math.max(0, 1 - elapsed / toast._duration);
      toast._progress.style.width = `${pct * 100}%`;
      if (pct > 0) toast._progressRaf = requestAnimationFrame(tick);
    });
  }

  function _pauseToastTimer(toast) {
    if (!toast || toast._isLoading || toast._paused || toast._dismissed) return;
    toast._paused = true;
    toast._remaining = Math.max(0, toast._duration - (performance.now() - toast._startedAt));
    clearTimeout(toast._autoTimer);
    cancelAnimationFrame(toast._progressRaf);
  }

  function _resumeToastTimer(toast) {
    if (!toast || toast._isLoading || !toast._paused || toast._dismissed) return;
    toast._paused = false;
    toast._duration = toast._remaining;
    toast._startedAt = performance.now();
    toast._autoTimer = setTimeout(() => _dismissToast(toast), toast._remaining);
    _startToastProgress(toast);
  }

  function _bindToastContainerPause() {
    if (!elements.toastContainer || elements.toastContainer._pauseBound) return;
    elements.toastContainer._pauseBound = true;
    elements.toastContainer.addEventListener('mouseenter', () => {
      _toastState.isHovered = true;
      _toastState.toasts.forEach(_pauseToastTimer);
    });
    elements.toastContainer.addEventListener('mouseleave', () => {
      _toastState.isHovered = false;
      _toastState.toasts.forEach(_resumeToastTimer);
    });
  }

  /**
   * 토스트 메시지 표시
   * @param {string} message - 표시할 메시지
   * @param {string} type - 타입 ('info', 'success', 'warning', 'error', 'loading')
   * @param {number} duration - 표시 시간 (ms)
   * @param {boolean} force - 설정과 무관하게 강제 표시
   */
  function showToast(message, type = 'info', duration = null, force = false) {
    // 기본 지속시간: 설정에서 읽기 (loading은 수동 dismiss이므로 무관)
    if (duration === null) duration = userSettings.getToastDuration();
    // 토스트 알림이 비활성화된 경우 (단, error와 force는 항상 표시)
    if (!force && type !== 'error' && !userSettings.getShowToastNotifications()) {
      return;
    }

    // warn/warning 통일
    const normalType = type === 'warning' ? 'warn' : type;

    _bindToastContainerPause();

    const toast = document.createElement('div');
    toast.className = `toast ${normalType} toast-enter`;

    // 아이콘
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = _toastIcons[normalType] || _toastIcons.info;
    toast.appendChild(icon);

    // 메시지
    const msg = document.createElement('span');
    msg.className = 'toast-message';
    msg.textContent = message;
    toast.appendChild(msg);

    // 닫기 버튼
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '\u00d7'; // ×
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _dismissToast(toast);
    });
    toast.appendChild(closeBtn);

    // loading 타입: 진행률 바 없이 스피너만 표시
    const isLoading = normalType === 'loading';
    toast._duration = duration;
    toast._remaining = duration;
    toast._startedAt = performance.now();
    toast._isLoading = isLoading;
    toast._paused = false;

    // 진행률 바
    const progress = document.createElement('div');
    progress.className = 'toast-progress';
    progress.style.width = '100%';
    if (isLoading) progress.style.display = 'none';
    toast.appendChild(progress);
    toast._progress = progress;

    // 스와이프 제스처
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swiping = false;
    let swipeDx = 0;

    toast.addEventListener('pointerdown', (e) => {
      if (e.target === closeBtn) return;
      swipeStartX = e.clientX;
      swipeStartY = e.clientY;
      swiping = false;
      swipeDx = 0;
      toast.setPointerCapture(e.pointerId);
      toast.style.transition = 'none';
    });

    toast.addEventListener('pointermove', (e) => {
      if (!swipeStartX) return;
      const dx = e.clientX - swipeStartX;
      const dy = e.clientY - swipeStartY;
      if (!swiping && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        swiping = true;
      }
      if (swiping) {
        swipeDx = dx;
        const opacity = Math.max(0, 1 - Math.abs(dx) / 200);
        toast.style.transform = `translateX(${dx}px) scale(${1 - Math.abs(dx) * 0.001})`;
        toast.style.opacity = opacity;
      }
    });

    toast.addEventListener('pointerup', () => {
      swipeStartX = 0;
      if (swiping) {
        if (Math.abs(swipeDx) > 80) {
          _dismissToast(toast, swipeDx);
        } else {
          toast.style.transition = '';
          toast.style.transform = '';
          toast.style.opacity = '';
        }
        swiping = false;
      } else {
        toast.style.transition = '';
      }
    });

    // 컨테이너에 추가 (최신이 맨 위)
    elements.toastContainer.prepend(toast);
    _toastState.toasts.unshift(toast);
    _updateToastStack();

    const timerPlan = computeToastTimerPlan({
      isHovered: _isToastContainerHovered(),
      isLoading
    });
    toast._paused = timerPlan.paused;

    // 자동 닫기 (loading 타입은 수동 dismiss)
    if (timerPlan.shouldStartProgress) {
      _startToastProgress(toast);
    }
    if (timerPlan.shouldScheduleAutoDismiss) {
      toast._autoTimer = setTimeout(() => _dismissToast(toast), duration);
    }

    // loading 타입: dismiss/update 핸들 반환
    if (isLoading) {
      return {
        dismiss: () => _dismissToast(toast),
        update: (newMessage, newType = 'success', newDuration = 3000) => {
          const newNormalType = newType === 'warning' ? 'warn' : newType;
          toast.className = `toast ${newNormalType}`;
          icon.innerHTML = _toastIcons[newNormalType] || _toastIcons.info;
          msg.textContent = newMessage;
          progress.style.display = '';
          scheduleMpvOverlayStateSync({ force: true });
          clearTimeout(toast._autoTimer);
          cancelAnimationFrame(toast._progressRaf);
          // 자동 닫기 재설정
          toast._duration = newDuration;
          toast._remaining = newDuration;
          toast._startedAt = performance.now();
          toast._isLoading = false;
          const updateTimerPlan = computeToastTimerPlan({
            isHovered: _isToastContainerHovered(),
            isLoading: false
          });
          toast._paused = updateTimerPlan.paused;
          if (updateTimerPlan.shouldStartProgress) {
            _startToastProgress(toast);
          }
          if (updateTimerPlan.shouldScheduleAutoDismiss) {
            toast._autoTimer = setTimeout(() => _dismissToast(toast), newDuration);
          }
        }
      };
    }
  }

  // G:/ 드라이브 경로 버튼 클릭 이벤트 위임 (전역)
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('.gdrive-link-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const path = btn.dataset.path;
      if (path && window.electronAPI?.showInFolder) {
        window.electronAPI.showInFolder(path);
      }
    }
  });

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
  let suppressPlayPauseShortcutKeyup = false;

  async function handleKeydown(e) {
    if (document.querySelector('.shortcut-key-btn.capturing')) return;
    if (shouldIgnoreComposingKeyboardEvent(e)) return;

    const shortcutTarget = getEffectiveKeyboardShortcutTarget(e, document);
    const isPlayPauseShortcut = userSettings.matchShortcut('playPause', e);
    const isPlayPauseAltShortcut = userSettings.matchShortcut('playPauseAlt', e);
    const isPlayPauseInput = isPlayPauseShortcut || isPlayPauseAltShortcut;
    if (isPlayPauseInput && !shouldHandlePlayPauseShortcutFromTarget(shortcutTarget, e)) return;

    // pending 마커 입력 중이면 단축키 무시 (textarea 포커스 전에도 적용)
    if (commentManager.pendingMarker) return;

    // 스레드 팝업이 열려있으면 단축키 무시
    const threadOverlay = document.getElementById('threadOverlay');
    if (threadOverlay?.classList.contains('open')) return;

    // 스플릿 뷰가 열려있으면 단축키 무시 (스플릿 뷰에서 자체 처리)
    const splitViewManager = getSplitViewManager();
    if (splitViewManager.isOpen()) return;

    // ====== 공통 단축키 (사용자 설정 기반) ======

    // 재생/일시정지
    if (isPlayPauseInput) {
      if (e.code === 'Space' && state.isDrawMode && !isFabricDrawingPilotEngaged()) {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        if (drawingManager.drawingCanvas.isDrawing) return;
        state.isSpaceHeld = true;
        state.spacePanUsed = false;
        elements.videoWrapper?.classList.add('space-pan');
        return;
      }
      if (e.code === 'Space') {
        suppressPlayPauseShortcutKeyup = true;
      }
      e.preventDefault();
      e.stopPropagation();
      handleUserPlayPauseToggle();
      return;
    }

    // 폼 컨트롤에서는 Space 재생을 제외한 전역 단축키를 무시한다.
    if (shouldIgnoreGlobalShortcutTarget(shortcutTarget)) return;

    if (fabricDrawingPilotController.routeKeydown(e)) return;
    if (shouldBlockFabricDrawingLegacyShortcut(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    // 댓글 모드
    if (userSettings.matchShortcut('commentMode', e)) {
      e.preventDefault();
      if (!state.isCommentMode && !(await ensureCutlistCommentTargetReady())) return;
      toggleCommentMode();
      return;
    }

    // 전체화면
    if (userSettings.matchShortcut('fullscreen', e)) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    // 시작점 설정
    if (userSettings.matchShortcut('setInPoint', e)) {
      e.preventDefault();
      btnSetInPoint.click();
      return;
    }

    // 종료점 설정
    if (userSettings.matchShortcut('setOutPoint', e)) {
      e.preventDefault();
      btnSetOutPoint.click();
      return;
    }

    // 구간 반복 토글
    if (userSettings.matchShortcut('toggleLoop', e)) {
      e.preventDefault();
      btnLoopToggle.click();
      return;
    }

    // 구간 반복 해제
    if (userSettings.matchShortcut('clearLoop', e)) {
      e.preventDefault();
      videoPlayer.clearLoop?.();
      return;
    }

    // 하이라이트 추가
    if (userSettings.matchShortcut('addHighlight', e)) {
      e.preventDefault();
      btnAddHighlight.click();
      return;
    }

    // 처음으로 이동
    if (userSettings.matchShortcut('goToStart', e)) {
      e.preventDefault();
      videoPlayer.seekToStart();
      return;
    }

    // 끝으로 이동
    if (userSettings.matchShortcut('goToEnd', e)) {
      e.preventDefault();
      videoPlayer.seekToEnd();
      return;
    }

    // ====== 시스템 단축키 (변경 불가) ======
    switch (e.code) {
    case 'Escape':
      if (state.isDrawMode && drawingManager.drawingCanvas.selection) {
        e.preventDefault();
        drawingManager.commitActiveSelection();
        return;
      }
      if (state.isFullscreen) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      break;

    case 'Slash':
      if (e.shiftKey) {
        e.preventDefault();
        elements.shortcutsToggle.click();
      }
      return;

    case 'Backslash':
      e.preventDefault();
      timeline.fitToView();
      return;

    case 'KeyS':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (reviewDataManager.getBframePath()) {
          reviewDataManager.save().then(saved => {
            if (saved) showToast('저장되었습니다', 'success');
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
    }

    // ====== 사용자 설정 기반 단축키 (변경 가능) ======

    // 실행취소/다시실행
    if (userSettings.matchShortcut('undo', e)) {
      e.preventDefault();
      if (await globalUndo()) showToast('실행 취소됨', 'info');
      return;
    }
    if (userSettings.matchShortcut('redo', e)) {
      e.preventDefault();
      if (await globalRedo()) showToast('다시 실행됨', 'info');
      return;
    }
    // Ctrl+Shift+Z도 Redo로 동작 (Ctrl+Y 외 대안)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyZ') {
      e.preventDefault();
      if (await globalRedo()) showToast('다시 실행됨', 'info');
      return;
    }

    // 드로잉 선택 영역 복사/붙여넣기 (select 도구)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyC'
        && state.isDrawMode && drawingManager.drawingCanvas.selection) {
      e.preventDefault();
      e.stopPropagation();
      if (drawingManager.drawingCanvas.copySelection()) {
        showToast('선택 영역이 복사되었습니다', 'success');
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyV'
        && state.isDrawMode && drawingManager.drawingCanvas.hasSelectionClipboard()) {
      e.preventDefault();
      e.stopPropagation();
      selectDrawingTool('select');
      if (drawingManager.drawingCanvas.pasteSelection()) {
        showToast('선택 영역이 붙여넣기 되었습니다', 'success');
      }
      return;
    }

    if (userSettings.matchShortcut('drawingLayerAdd', e)) {
      e.preventDefault();
      addDrawingLayer();
      return;
    }
    if (userSettings.matchShortcut('drawingLayerDelete', e)) {
      e.preventDefault();
      deleteActiveDrawingLayer();
      return;
    }
    if (userSettings.matchShortcut('drawingLayerSelectUp', e)) {
      e.preventDefault();
      selectDrawingLayerByOffset(-1);
      return;
    }
    if (userSettings.matchShortcut('drawingLayerSelectDown', e)) {
      e.preventDefault();
      selectDrawingLayerByOffset(1);
      return;
    }
    if (userSettings.matchShortcut('drawingLayerMoveUp', e)) {
      e.preventDefault();
      moveDrawingLayerByOffset(-1);
      return;
    }
    if (userSettings.matchShortcut('drawingLayerMoveDown', e)) {
      e.preventDefault();
      moveDrawingLayerByOffset(1);
      return;
    }
    if (userSettings.matchShortcut('drawingLayerVisibilityToggle', e)) {
      if (!state.isDrawMode) return;
      e.preventDefault();
      const layer = drawingManager.getActiveLayer();
      if (layer) {
        drawingManager.toggleLayerVisibility(layer.id);
        showToast(layer.visible ? '레이어 표시됨' : '레이어 숨김', 'info');
      }
      return;
    }
    if (userSettings.matchShortcut('drawingLayerLockToggle', e)) {
      if (!state.isDrawMode) return;
      e.preventDefault();
      const layer = drawingManager.getActiveLayer();
      if (layer) {
        drawingManager.toggleLayerLock(layer.id);
        showToast(layer.locked ? '레이어 잠금' : '레이어 잠금 해제', 'info');
      }
      return;
    }
    if (userSettings.matchShortcut('timelineCenterOnPlayhead', e)) {
      e.preventDefault();
      timeline.centerOnPlayhead();
      return;
    }

    const matchedBrushSizeAction = userSettings.findActionByEvent(e);
    if (state.isDrawMode && (matchedBrushSizeAction === 'brushSizeDown' || matchedBrushSizeAction === 'brushSizeUp')) {
      e.preventDefault();
      const delta = matchedBrushSizeAction === 'brushSizeDown' ? -1 : 1;
      adjustBrushSizeBy(delta, { persist: true });
      return;
    }

    // 키프레임 삭제 (그리기 모드에서만)
    if (userSettings.matchShortcut('keyframeDelete', e)) {
      if (state.isDrawMode) {
        e.preventDefault();
        deleteSelectedOrCurrentKeyframes();
      }
      return;
    }

    // 키프레임 추가 (복사)
    if (userSettings.matchShortcut('keyframeAddWithCopy', e)) {
      e.preventDefault();
      if (state.isDrawMode) {
        drawingManager.addKeyframeWithContent();
        showToast('키프레임 추가됨', 'success');
      }
      return;
    }

    // 빈 키프레임 추가
    if (userSettings.matchShortcut('keyframeAddBlank', e)) {
      e.preventDefault();
      if (state.isDrawMode) {
        drawingManager.addBlankKeyframe();
        showToast('빈 키프레임 추가됨', 'success');
      }
      return;
    }

    // 프레임 복사 (Ctrl+Alt+C)
    if (userSettings.matchShortcut('frameCopy', e)) {
      if (!state.isDrawMode) return;
      e.preventDefault();
      e.stopPropagation();
      const selected = Array.isArray(timeline.selectedKeyframes) && timeline.selectedKeyframes.length > 0
        ? timeline.selectedKeyframes
        : null;
      const copiedCount = drawingManager.copyFrames(selected);
      if (copiedCount > 0) {
        showToast(`프레임 ${copiedCount}개 복사됨`, 'success');
      } else {
        showToast('복사할 프레임이 없습니다', 'warning');
      }
      return;
    }
    // 프레임 붙여넣기 (Ctrl+Alt+V)
    if (userSettings.matchShortcut('framePaste', e)) {
      if (!state.isDrawMode) return;
      e.preventDefault();
      e.stopPropagation();
      const pastedCount = drawingManager.pasteFrames();
      if (pastedCount > 0) {
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
        showToast(`프레임 ${pastedCount}개 붙여넣기됨`, 'success');
      } else {
        showToast('붙여넣을 프레임이 없습니다', 'warning');
      }
      return;
    }

    // 프레임 이동 단축키
    if (userSettings.matchShortcut('prevSecond', e)) {
      e.preventDefault();
      const secondAmount = userSettings.getSecondSkipAmount();
      const newTime = Math.max(0, (videoPlayer.currentTime || 0) - secondAmount);
      videoPlayer.seek(newTime);
      timeline.scrollToPlayhead();
      return;
    }
    if (userSettings.matchShortcut('nextSecond', e)) {
      e.preventDefault();
      const secondAmount = userSettings.getSecondSkipAmount();
      const duration = videoPlayer.duration || 0;
      const newTime = Math.min(duration, (videoPlayer.currentTime || 0) + secondAmount);
      videoPlayer.seek(newTime);
      timeline.scrollToPlayhead();
      return;
    }
    if (userSettings.matchShortcut('prevFrameFast', e)) {
      e.preventDefault();
      const frameAmount = userSettings.getFrameSkipAmount();
      videoPlayer.stepFrames(-frameAmount);
      timeline.scrollToPlayhead();
      return;
    }
    if (userSettings.matchShortcut('nextFrameFast', e)) {
      e.preventDefault();
      const frameAmount = userSettings.getFrameSkipAmount();
      videoPlayer.stepFrames(frameAmount);
      timeline.scrollToPlayhead();
      return;
    }
    if (userSettings.matchShortcut('prevFrame', e)) {
      e.preventDefault();
      videoPlayer.prevFrame();
      return;
    }
    if (userSettings.matchShortcut('nextFrame', e)) {
      e.preventDefault();
      videoPlayer.nextFrame();
      return;
    }

    // Alt+Arrow: 하이라이트 이동 (설정 기반 아님, 하드코딩 유지)
    if (e.altKey && e.code === 'ArrowLeft') {
      e.preventDefault();
      const prevHighlightTime = highlightManager.getPrevHighlightTime(videoPlayer.currentTime || 0);
      if (prevHighlightTime !== null) {
        videoPlayer.seek(prevHighlightTime);
        timeline.scrollToPlayhead();
      } else {
        showToast('이전 하이라이트가 없습니다', 'info');
      }
      return;
    }
    if (e.altKey && e.code === 'ArrowRight') {
      e.preventDefault();
      const nextHighlightTime = highlightManager.getNextHighlightTime(videoPlayer.currentTime || 0);
      if (nextHighlightTime !== null) {
        videoPlayer.seek(nextHighlightTime);
        timeline.scrollToPlayhead();
      } else {
        showToast('다음 하이라이트가 없습니다', 'info');
      }
      return;
    }

    // 그리기 모드 토글 (피드백 33: 모드 중 B는 먼저 브러시로 복귀, 브러시 상태에서 B면 종료)
    if (userSettings.matchShortcut('drawMode', e)) {
      e.preventDefault();
      if (!state.isDrawMode) {
        toggleDrawMode();
        // 진입 시에는 마지막으로 저장된 도구를 복원
        const savedTool = userSettings.getBrushSettings().tool || currentToolName || 'brush';
        const toolBtn = document.querySelector(`.tool-btn[data-tool="${savedTool}"]`) || document.querySelector('.tool-btn[data-tool="brush"]');
        if (toolBtn) toolBtn.click();
      } else if (currentToolName !== 'brush') {
        const brushBtn = document.querySelector('.tool-btn[data-tool="brush"]');
        if (brushBtn) brushBtn.click();
      } else {
        toggleDrawMode();
      }
      return;
    }
    if (userSettings.matchShortcut('prevFrameDraw', e)) {
      e.preventDefault();
      videoPlayer.prevFrame();
      return;
    }
    if (userSettings.matchShortcut('nextFrameDraw', e)) {
      e.preventDefault();
      videoPlayer.nextFrame();
      return;
    }
    if (userSettings.matchShortcut('prevKeyframe', e)) {
      e.preventDefault();
      const prevKf = drawingManager.getPrevKeyframeFrame();
      if (prevKf !== null) videoPlayer.seekToFrame(prevKf);
      return;
    }
    if (userSettings.matchShortcut('nextKeyframe', e)) {
      e.preventDefault();
      const nextKf = drawingManager.getNextKeyframeFrame();
      if (nextKf !== null) videoPlayer.seekToFrame(nextKf);
      return;
    }
    // 1: 어니언 스킨 토글
    if (userSettings.matchShortcut('onionSkinToggle', e)) {
      e.preventDefault();
      toggleOnionSkinWithUI();
      return;
    }
    // 2: 빈 키프레임 삽입
    if (userSettings.matchShortcut('keyframeAddBlank2', e)) {
      e.preventDefault();
      drawingManager.addBlankKeyframe();
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      return;
    }
    // Shift+2: 키프레임을 일반 프레임으로 변환
    if (userSettings.matchShortcut('keyframeConvertToFrame', e)) {
      e.preventDefault();
      if (drawingManager.convertKeyframeToFrame()) {
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      }
      return;
    }
    // Shift+3: 현재 프레임을 키프레임으로 변환
    if (userSettings.matchShortcut('keyframeConvertToKeyframe', e)) {
      e.preventDefault();
      if (drawingManager.convertFrameToKeyframe()) {
        timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      }
      return;
    }
    // 3: 프레임 삽입 (홀드 추가)
    if (userSettings.matchShortcut('insertFrame', e)) {
      e.preventDefault();
      drawingManager.insertFrame();
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      return;
    }
    // 4: 프레임 삭제
    if (userSettings.matchShortcut('deleteFrame', e)) {
      e.preventDefault();
      drawingManager.deleteFrame();
      timeline.renderDrawingLayers(drawingManager.layers, drawingManager.activeLayerId);
      return;
    }
    // E: 지우개 모드 (드로잉 모드에서만 작동)
    if (e.code === 'KeyE' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      // 드로잉 모드가 아니면 무시
      if (!state.isDrawMode) return;
      e.preventDefault();
      // 지우개 버튼 클릭으로 UI와 도구 함께 전환
      const eraserBtn = document.querySelector('.tool-btn[data-tool="eraser"]');
      if (eraserBtn) {
        eraserBtn.click();
      }
      return;
    }
    // 피드백 26: V = 선택 도구 활성화 (Animate와 동일). 기존 '드로잉 모드 종료' 동작을 대체한다.
    if (userSettings.matchShortcut('drawingToolSelect', e)) {
      // 드로잉 모드가 아니면 무시
      if (!state.isDrawMode) return;
      e.preventDefault();
      // 선택 버튼 클릭으로 UI와 도구 함께 전환 (E 지우개 패턴과 동일)
      const selectBtn = document.querySelector('.tool-btn[data-tool="select"]');
      if (selectBtn) {
        selectBtn.click();
      }
      return;
    }
  }

  function handleKeyup(e) {
    if (e.code !== 'Space') return;
    if (state.isSpaceHeld) {
      e.preventDefault();
      e.stopPropagation();
      const shouldTogglePlayback = !state.spacePanUsed && !state.isPanningVideo;
      state.isSpaceHeld = false;
      state.spacePanUsed = false;
      elements.videoWrapper?.classList.remove('space-pan');
      if (shouldTogglePlayback) handleUserPlayPauseToggle();
      return;
    }
    if (!suppressPlayPauseShortcutKeyup) return;
    e.preventDefault();
    e.stopPropagation();
    suppressPlayPauseShortcutKeyup = false;
  }

  // 초기화 완료
  // ====== 외부에서 파일 열기 처리 ======

  /**
   * 외부에서 전달된 파일 처리 (.bframe 또는 영상 파일)
   */
  async function handleExternalFile(filePath) {
    log.info('외부 파일 열기', { filePath });

    // 재귀 호출(baeframe:// → 실제 경로)의 경우 오버레이 중복 방지
    const isRecursive = filePath.startsWith('baeframe://');

    // 로딩 오버레이 표시 (최상위 호출에서만)
    const loadingOverlay = document.getElementById('videoLoadingOverlay');
    const loadingText = document.getElementById('loadingText');

    if (!isRecursive && loadingOverlay && !loadingOverlay.classList.contains('active')) {
      loadingOverlay.classList.add('active');
      if (loadingText) loadingText.textContent = '파일을 불러오는 중...';
    }

    try {
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
            loadingOverlay?.classList.remove('active');
          }
        } catch (error) {
          log.error('.bframe 파일 처리 실패', error);
          showToast('.bframe 파일을 열 수 없습니다', 'error');
          loadingOverlay?.classList.remove('active');
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
        // loadVideo → generateThumbnails 내부에서 오버레이 텍스트 변경 및 해제 처리
        await loadVideo(filePath);
      }
    } catch (error) {
      log.error('외부 파일 열기 실패', error);
      showToast('파일을 열 수 없습니다', 'error');
      loadingOverlay?.classList.remove('active');
    }
  }

  // 프로토콜/파일 열기 이벤트 리스너
  window.electronAPI.onOpenFromProtocol((arg, commentId) => {
    log.info('프로토콜/파일 열기 이벤트 수신', { arg, commentId });
    // commentId가 있으면 파일 로드 후 해당 코멘트로 포커싱
    if (commentId) {
      state.pendingCommentFocus = commentId;
    }
    handleExternalFile(arg);
  });

  // ====== 앱 종료 전 저장 처리 ======
  window.electronAPI.onRequestSaveBeforeQuit(async () => {
    log.info('앱 종료 전 저장 요청 수신');
    const savingOverlay = document.getElementById('appSavingOverlay');

    // 협업 세션 종료 (presence 제거)
    commentSync.stop();
    drawingSync.stop();
    await liveblocksManager.stop();

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
  applySavedBrushSettings(userSettings.getBrushSettings());

  // AuthManager 초기화
  const authManager = getAuthManager();
  await authManager.init();

  if (!authManager.isAuthAvailable()) {
    log.warn('인증 파일 접근 불가 - 비보호 모드로 실행');
    // 비보호 모드 알림은 사용자 이름 설정 이후에 표시
  }

  let userName = await userSettings.initialize();
  log.info('사용자 이름 감지됨', { userName, source: userSettings.getUserSource() });

  // 사용자 이름 업데이트 함수
  function updateUserName(name) {
    userName = name;
    const userNameDisplay = document.getElementById('userNameDisplay');
    if (userNameDisplay) {
      userNameDisplay.textContent = name;
      userNameDisplay.title = `출처: ${userSettings.getUserSource()}`;

      // 어드민 뱃지 표시
      let adminBadge = userNameDisplay.parentElement?.querySelector('.admin-badge');
      if (authManager.isAdmin()) {
        if (!adminBadge) {
          adminBadge = document.createElement('span');
          adminBadge.className = 'admin-badge';
          adminBadge.textContent = 'ADMIN';
          userNameDisplay.parentElement?.appendChild(adminBadge);
        }
        adminBadge.style.display = '';
      } else if (adminBadge) {
        adminBadge.style.display = 'none';
      }
    }
    commentManager.setAuthor(name);
    // 보호 사용자 메뉴 토글
    updateAuthMenuVisibility();
  }

  // 인증 관련 메뉴 표시/숨기기
  function updateAuthMenuVisibility() {
    const btnChangePassword = document.getElementById('btnChangePassword');
    const btnChangeTheme = document.getElementById('btnChangeTheme');
    const isProtected = authManager.isCurrentUserProtected();
    if (btnChangePassword) btnChangePassword.style.display = isProtected ? '' : 'none';
    if (btnChangeTheme) btnChangeTheme.style.display = isProtected ? '' : 'none';
  }

  // 사용자 이름을 헤더에 표시 (옵션)
  updateUserName(userName);

  // 인증 상태 복원: 저장된 이름이 보호 사용자이면 세션에 로그인 상태로 처리
  if (userSettings.hasSetNameOnce() && userName && userName !== '익명') {
    if (authManager.isProtectedUser(userName)) {
      // 이전에 로그인했던 보호 사용자 - 세션 유지 (재인증 없이)
      authManager.currentUser = { name: userName, protected: true, theme: authManager._findUser?.(userName)?.theme || null };
      authManager.isAuthenticated = true;
      updateAuthMenuVisibility();
      log.info('보호 사용자 세션 복원', { name: userName });
    } else {
      // 비보호 사용자
      authManager.currentUser = { name: userName, protected: false, theme: null };
      authManager.isAuthenticated = true;
    }
  }

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

  // ===== Phase 2c: 격자 토글 UI 배선 =====
  function _syncGridToggleUI(visible) {
    if (elements.btnGridToggle) {
      elements.btnGridToggle.classList.toggle('active', visible);
      elements.btnGridToggle.setAttribute('aria-pressed', String(visible));
    }
  }

  const initGridVisible = userSettings.getShowFrameGrid();
  timeline.setGridVisible(initGridVisible);
  _syncGridToggleUI(initGridVisible);

  if (elements.btnGridToggle) {
    elements.btnGridToggle.addEventListener('click', () => {
      const next = !userSettings.getShowFrameGrid();
      userSettings.setShowFrameGrid(next);
      timeline.setGridVisible(next);
      _syncGridToggleUI(next);
    });
  }

  const FRAME_CELL_MODE_ORDER = ['auto', 'on', 'off'];
  const FRAME_CELL_MODE_LABEL = { auto: 'A', on: 'ON', off: 'OFF' };

  function _syncFrameCellModeUI(mode) {
    if (!elements.btnFrameCellMode) return;
    elements.btnFrameCellMode.dataset.mode = mode;
    elements.btnFrameCellMode.classList.toggle('active', mode !== 'off');
    elements.btnFrameCellMode.title = `프레임 1칸 표시: ${mode.toUpperCase()} (클릭으로 전환)`;
    const badge = document.getElementById('frameCellModeBadge');
    if (badge) badge.textContent = FRAME_CELL_MODE_LABEL[mode] || 'A';
  }

  const initFrameCellMode = userSettings.getFrameCellMode();
  timeline.setFrameCellMode(initFrameCellMode);
  _syncFrameCellModeUI(initFrameCellMode);

  elements.btnFrameCellMode?.addEventListener('click', () => {
    const cur = userSettings.getFrameCellMode();
    const next = FRAME_CELL_MODE_ORDER[(FRAME_CELL_MODE_ORDER.indexOf(cur) + 1) % 3];
    userSettings.setFrameCellMode(next);
    timeline.setFrameCellMode(next);
    _syncFrameCellModeUI(next);
    showToast(`프레임 1칸 표시: ${next.toUpperCase()}`, 'info');
  });

  function _syncCommentTimelineRangesToggleUI(show) {
    if (elements.toggleCommentTimelineRanges) {
      elements.toggleCommentTimelineRanges.checked = show;
    }
  }

  const initCommentTimelineRangesVisible = userSettings.getShowCommentTimelineRanges();
  timeline.setCommentRangesVisible(initCommentTimelineRangesVisible);
  _syncCommentTimelineRangesToggleUI(initCommentTimelineRangesVisible);

  elements.toggleCommentTimelineRanges?.addEventListener('change', (e) => {
    const show = e.target.checked;
    userSettings.setShowCommentTimelineRanges(show);
    timeline.setCommentRangesVisible(show);
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

  // 저장 (인증 시스템 연동)
  async function saveUserName() {
    const newName = userNameInput.value.trim();
    if (!newName) {
      showToast('이름을 입력해주세요.', 'warning');
      userNameInput.focus();
      return;
    }

    // 보호된 사용자인지 확인
    if (authManager.isProtectedUser(newName)) {
      // 이미 현재 로그인한 사용자와 같으면 그냥 통과
      if (authManager.getCurrentUserName() === newName) {
        userSettings.setUserName(newName);
        updateUserName(newName);
        showToast(`이름이 "${newName}"(으)로 변경되었습니다.`, 'success');
        isRequiredNameInput = false;
        userSettingsModal.classList.remove('active');
        if (closeUserSettings) closeUserSettings.style.display = '';
        if (cancelUserSettings) cancelUserSettings.style.display = '';
        return;
      }

      // 로그인 모달 표시
      userSettingsModal.classList.remove('active');
      isRequiredNameInput = false;
      if (closeUserSettings) closeUserSettings.style.display = '';
      if (cancelUserSettings) cancelUserSettings.style.display = '';
      openLoginModal(newName);
      return;
    }

    // 비보호 사용자 - 바로 설정
    authManager.logout();
    await authManager.login(newName, null);
    userSettings.setUserName(newName);
    updateUserName(newName);
    showToast(`이름이 "${newName}"(으)로 변경되었습니다.`, 'success');
    isRequiredNameInput = false;
    userSettingsModal.classList.remove('active');
    if (closeUserSettings) closeUserSettings.style.display = '';
    if (cancelUserSettings) cancelUserSettings.style.display = '';
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

  // ====== 앱 설정 모달 ======
  const appSettingsModal = document.getElementById('appSettingsModal');
  const closeAppSettings = document.getElementById('closeAppSettings');
  const btnAppSettings = document.getElementById('btnAppSettings');

  async function updateMpvPilotSettingsStatus() {
    const status = document.getElementById('appSettingsMpvPilotStatus');
    if (!status) return;

    if (!userSettings.getMpvPlaybackEnabled()) {
      status.textContent = '꺼져 있습니다. 영상은 기존 변환(FFmpeg) 방식으로 재생됩니다.';
      return;
    }

    if (!window.electronAPI?.mpvIsAvailable) {
      status.textContent = '이 앱 버전에서는 mpv 상태 확인을 사용할 수 없습니다.';
      return;
    }

    status.textContent = 'mpv 실행 파일을 확인하는 중...';
    try {
      const available = await window.electronAPI.mpvIsAvailable();
      status.textContent = available
        ? 'mpv를 찾았습니다. 다음 영상부터 원본 직접 재생을 시도합니다.'
        : 'mpv.exe를 찾지 못했습니다. 영상은 기존 변환 방식으로 재생됩니다.';
    } catch (error) {
      log.warn('mpv 파일럿 설정 상태 확인 실패', { error: error.message });
      status.textContent = 'mpv 상태 확인에 실패했습니다. 영상은 기존 방식으로 재생됩니다.';
    }
  }

  function openAppSettingsModal() {
    if (!appSettingsModal) return;
    // 현재 값 로드
    const nameInput = document.getElementById('appSettingsUserName');
    if (nameInput) nameInput.value = userSettings.getUserName();

    const toastEnabled = document.getElementById('appSettingsToastEnabled');
    if (toastEnabled) toastEnabled.checked = userSettings.getShowToastNotifications();

    const durationSlider = document.getElementById('appSettingsToastDuration');
    const durationValue = document.getElementById('appSettingsToastDurationValue');
    if (durationSlider) {
      durationSlider.value = userSettings.getToastDuration();
      if (durationValue) durationValue.textContent = `${userSettings.getToastDuration() / 1000}초`;
    }

    // 위치 버튼 활성화
    const posGrid = document.getElementById('toastPositionGrid');
    if (posGrid) {
      posGrid.querySelectorAll('.toast-pos-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pos === userSettings.getToastPosition());
      });
    }

    // 미리보기 위치
    _updateToastPreviewPosition(userSettings.getToastPosition());

    // 테마 탭 초기값
    const lmToggle = document.getElementById('appSettingsLightMode');
    if (lmToggle) lmToggle.checked = userSettings.getLightMode();

    // 재생 탭 초기값
    const mpvPilotEnabled = document.getElementById('appSettingsMpvPilotEnabled');
    if (mpvPilotEnabled) mpvPilotEnabled.checked = userSettings.getMpvPlaybackEnabled();
    const hybridReviewEngineToggle = document.getElementById('appSettingsHybridReviewEngine');
    if (hybridReviewEngineToggle) hybridReviewEngineToggle.checked = userSettings.getHybridReviewEngine();
    updateMpvPilotSettingsStatus();

    const tGrid = document.getElementById('appThemeColorGrid');
    if (tGrid) {
      const curTheme = userSettings.getLocalTheme();
      tGrid.querySelectorAll('.theme-color-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === curTheme);
      });
    }

    // 초기 비밀번호 경고 표시
    const pwWarning = document.getElementById('appSettingsPasswordWarning');
    if (pwWarning) {
      const showWarning = authManager.isCurrentUserProtected() && authManager.currentUserHasInitialPassword();
      pwWarning.style.display = showWarning ? 'flex' : 'none';
    }

    // 단축키 설정 렌더링
    renderShortcutSettings();

    appSettingsModal.classList.add('active');
  }

  function closeAppSettingsModal() {
    if (!appSettingsModal) return;
    appSettingsModal.classList.remove('active');

    // 단축키 캡처 모드 해제 — 설정창 닫힐 때 캡처 중이면 원래 키 표시로 복원
    if (capturingShortcutAction) {
      const capturingBtn = document.querySelector(`.shortcut-key-btn.capturing[data-action="${capturingShortcutAction}"]`);
      if (capturingBtn) {
        const shortcuts = userSettings.getShortcuts();
        const sc = shortcuts[capturingShortcutAction];
        capturingBtn.textContent = sc ? formatShortcutDisplay(sc) : capturingShortcutAction;
        capturingBtn.classList.remove('capturing');
      }
      capturingShortcutAction = null;
    }
  }

  // 앱 설정 열기 버튼
  btnAppSettings?.addEventListener('click', () => {
    // 드롭다운 닫기
    const dropdown = document.getElementById('commentSettingsDropdown');
    if (dropdown) dropdown.classList.remove('show');
    openAppSettingsModal();
  });

  closeAppSettings?.addEventListener('click', closeAppSettingsModal);

  // 오버레이 클릭으로 닫기
  appSettingsModal?.addEventListener('click', (e) => {
    if (e.target === appSettingsModal) closeAppSettingsModal();
  });

  // Escape로 닫기
  appSettingsModal?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAppSettingsModal();
  });

  // 탭 전환
  appSettingsModal?.querySelectorAll('.app-settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      appSettingsModal.querySelectorAll('.app-settings-tab').forEach(t => t.classList.remove('active'));
      appSettingsModal.querySelectorAll('.app-settings-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = appSettingsModal.querySelector(`.app-settings-panel[data-panel="${tab.dataset.tab}"]`);
      if (panel) panel.classList.add('active');
    });
  });

  // === 단축키 설정 UI ===
  const SHORTCUT_CATEGORIES = {
    '재생': ['playPause', 'playPauseAlt', 'prevFrame', 'nextFrame', 'prevFrameFast', 'nextFrameFast', 'prevSecond', 'nextSecond', 'goToStart', 'goToEnd'],
    '모드': ['commentMode', 'drawMode', 'fullscreen'],
    '구간 반복': ['setInPoint', 'setOutPoint', 'toggleLoop', 'clearLoop', 'addHighlight'],
    '실행취소': ['undo', 'redo'],
    '키프레임': ['keyframeAddWithCopy', 'keyframeAddBlank', 'keyframeAddBlank2', 'keyframeConvertToFrame', 'keyframeConvertToKeyframe', 'keyframeDelete', 'prevKeyframe', 'nextKeyframe'],
    '프레임 편집': ['insertFrame', 'deleteFrame', 'frameCopy', 'framePaste'],
    '드로잉 레이어': ['drawingLayerAdd', 'drawingLayerDelete', 'drawingLayerVisibilityToggle', 'drawingLayerLockToggle', 'drawingLayerSelectUp', 'drawingLayerSelectDown', 'drawingLayerMoveUp', 'drawingLayerMoveDown', 'timelineCenterOnPlayhead'],
    '그리기 보조': ['onionSkinToggle', 'prevFrameDraw', 'nextFrameDraw', 'brushSizeDown', 'brushSizeUp', 'drawingToolSelect']
  };

  let capturingShortcutAction = null;

  function keyCodeToDisplay(code) {
    const map = {
      'Space': 'Space', 'ArrowLeft': '←', 'ArrowRight': '→', 'ArrowUp': '↑', 'ArrowDown': '↓',
      'Home': 'Home', 'End': 'End', 'Delete': 'Del', 'Backspace': 'Back', 'Backquote': '`',
      'Enter': 'Enter', 'Tab': 'Tab', 'Escape': 'Esc'
    };
    if (map[code]) return map[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }

  function formatShortcutDisplay(sc) {
    const parts = [];
    if (sc.ctrl) parts.push('Ctrl');
    if (sc.shift) parts.push('Shift');
    if (sc.alt) parts.push('Alt');
    parts.push(keyCodeToDisplay(sc.key));
    return parts.join(' + ');
  }

  // 시스템 예약 키 (handleKeydown에서 하드코딩, 사용자 설정보다 먼저 실행)
  const RESERVED_SHORTCUTS = [
    { key: 'Escape', ctrl: false, shift: false, alt: false, label: 'ESC (전체화면 해제)' },
    { key: 'KeyS', ctrl: true, shift: false, alt: false, label: 'Ctrl+S (저장)' },
    { key: 'Equal', ctrl: true, shift: false, alt: false, label: 'Ctrl++ (줌인)' },
    { key: 'NumpadAdd', ctrl: true, shift: false, alt: false, label: 'Ctrl++ (줌인)' },
    { key: 'Minus', ctrl: true, shift: false, alt: false, label: 'Ctrl+- (줌아웃)' },
    { key: 'NumpadSubtract', ctrl: true, shift: false, alt: false, label: 'Ctrl+- (줌아웃)' },
    { key: 'Slash', ctrl: false, shift: true, alt: false, label: 'Shift+/ (단축키 목록)' },
    { key: 'Backslash', ctrl: false, shift: false, alt: false, label: '\\ (타임라인 맞춤)' }
  ];

  function findShortcutConflict(newSc, excludeAction) {
    // 시스템 예약 키 충돌 검사
    for (const reserved of RESERVED_SHORTCUTS) {
      if (newSc.key === reserved.key && newSc.ctrl === reserved.ctrl &&
          newSc.shift === reserved.shift && newSc.alt === reserved.alt) {
        return { action: '_reserved', label: `${reserved.label} [시스템 예약]` };
      }
    }
    // 사용자 설정 간 충돌 검사
    const all = userSettings.getShortcuts();
    for (const [action, sc] of Object.entries(all)) {
      if (action === excludeAction) continue;
      if (sc.key === newSc.key && sc.ctrl === newSc.ctrl && sc.shift === newSc.shift && sc.alt === newSc.alt) {
        return { action, label: sc.label || action };
      }
    }
    return null;
  }

  function renderShortcutSettings() {
    const container = document.getElementById('settingsShortcutList');
    if (!container) return;

    const shortcuts = userSettings.getShortcuts();
    const customShortcuts = userSettings.settings?.customShortcuts || {};

    container.innerHTML = Object.entries(SHORTCUT_CATEGORIES).map(([cat, actions]) => `
      <div class="shortcut-category">
        <h5 class="shortcut-category-title">${cat}</h5>
        ${actions.filter(a => shortcuts[a]).map(action => {
    const sc = shortcuts[action];
    const isCustom = !!customShortcuts[action];
    return `
            <div class="shortcut-row ${isCustom ? 'custom' : ''}" data-action="${action}">
              <span class="shortcut-label">${escapeHtml(sc.label || action)}</span>
              <div class="shortcut-key-area">
                <button class="shortcut-key-btn" data-action="${action}">${formatShortcutDisplay(sc)}</button>
                ${isCustom ? `<button class="shortcut-reset-btn" data-action="${action}" title="기본값 복원">↩</button>` : ''}
              </div>
            </div>`;
  }).join('')}
      </div>
    `).join('');

  }

  // 전체 초기화 버튼 (한 번만 등록)
  document.getElementById('settingsResetAllShortcuts')?.addEventListener('click', () => {
    userSettings.resetAllShortcuts();
    renderShortcutSettings();
    showToast('모든 단축키가 초기화되었습니다.', 'success');
  });

  // 단축키 설정 패널 클릭 이벤트 위임
  document.getElementById('settingsShortcutList')?.addEventListener('click', (e) => {
    // 키 바인딩 버튼 클릭 → 캡처 모드
    const keyBtn = e.target.closest('.shortcut-key-btn');
    if (keyBtn) {
      capturingShortcutAction = keyBtn.dataset.action;
      keyBtn.textContent = '키를 누르세요...';
      keyBtn.classList.add('capturing');
      return;
    }

    // 개별 초기화 버튼
    const resetBtn = e.target.closest('.shortcut-reset-btn');
    if (resetBtn) {
      userSettings.resetShortcut(resetBtn.dataset.action);
      renderShortcutSettings();
      showToast('단축키가 초기화되었습니다.', 'success');
    }
  });

  // 단축키 캡처 (capture phase)
  document.addEventListener('keydown', (e) => {
    if (!capturingShortcutAction) return;

    e.preventDefault();
    e.stopPropagation();

    // Escape → 취소
    if (e.key === 'Escape') {
      capturingShortcutAction = null;
      renderShortcutSettings();
      return;
    }

    // 수정자 키만 누른 경우 무시
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    const newShortcut = {
      key: e.code,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey
    };

    // 충돌 감지
    const conflict = findShortcutConflict(newShortcut, capturingShortcutAction);
    if (conflict) {
      showToast(`"${conflict.label}"과(와) 충돌합니다.`, 'warning');
      return;
    }

    userSettings.setShortcut(capturingShortcutAction, newShortcut);
    capturingShortcutAction = null;
    renderShortcutSettings();
    showToast('단축키가 변경되었습니다.', 'success');
  }, true); // capture phase

  // 개인정보 - 이름 변경 (blur 시 자동 저장)
  document.getElementById('appSettingsUserName')?.addEventListener('change', (e) => {
    const name = e.target.value.trim();
    if (name) {
      userSettings.setUserName(name);
      showToast(`이름이 "${name}"으로 변경되었습니다.`, 'success');
    }
  });

  // 비밀번호 변경 (앱 설정 내)
  document.getElementById('appSettingsChangePassword')?.addEventListener('click', () => {
    closeAppSettingsModal();
    openChangePasswordModal();
  });

  // 알림 표시 토글
  document.getElementById('appSettingsToastEnabled')?.addEventListener('change', (e) => {
    userSettings.setShowToastNotifications(e.target.checked);
    // 기존 드롭다운 체크박스와 동기화
    const oldToggle = document.getElementById('toggleToastNotifications');
    if (oldToggle) oldToggle.checked = e.target.checked;
  });

  // 알림 위치
  document.getElementById('toastPositionGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.toast-pos-btn');
    if (!btn) return;
    const pos = btn.dataset.pos;
    document.querySelectorAll('.toast-pos-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    userSettings.setToastPosition(pos);
    _applyToastPosition(pos);
    _updateToastPreviewPosition(pos);
  });

  // 알림 지속시간 슬라이더
  document.getElementById('appSettingsToastDuration')?.addEventListener('input', (e) => {
    const ms = parseInt(e.target.value);
    const label = document.getElementById('appSettingsToastDurationValue');
    if (label) label.textContent = `${ms / 1000}초`;
    userSettings.setToastDuration(ms);
  });

  document.getElementById('appSettingsMpvPilotEnabled')?.addEventListener('change', (e) => {
    userSettings.setMpvPlaybackEnabled(e.target.checked);
    updateMpvPilotSettingsStatus();
    showToast(
      e.target.checked
        ? 'mpv 직접 재생을 켰습니다. 다음 영상부터 원본을 바로 재생합니다.'
        : 'mpv 직접 재생을 껐습니다. 다음 영상부터 기존 변환 방식으로 재생합니다.',
      'info'
    );
  });

  document.getElementById('appSettingsHybridReviewEngine')?.addEventListener('change', (e) => {
    userSettings.setHybridReviewEngine(e.target.checked);
    showToast(
      e.target.checked
        ? '그리기/댓글 모드에서 표준 재생을 사용합니다. 다음 모드 진입부터 적용됩니다.'
        : '그리기/댓글 모드에서 기존 freeze 방식을 사용합니다.',
      'info'
    );
  });

  // 미리보기 위치 업데이트
  function _updateToastPreviewPosition(pos) {
    const sample = document.getElementById('toastPreviewSample');
    if (!sample) return;
    sample.style.top = sample.style.bottom = sample.style.left = sample.style.right = '';
    sample.style.transform = '';
    sample.dataset.pos = pos;
  }

  // 미리보기 클릭 시 실제 토스트 표시
  document.getElementById('toastPreviewBox')?.addEventListener('click', () => {
    showToast('알림 미리보기', 'info', null, true);
  });

  // 토스트 컨테이너 위치 동적 적용
  function _applyToastPosition(pos) {
    const c = elements.toastContainer;
    if (!c) return;
    // 전체 리셋
    c.style.top = c.style.bottom = c.style.left = c.style.right = '';
    c.style.transform = '';
    c.style.alignItems = '';
    c.style.flexDirection = '';
    c.style.marginLeft = '';
    c.style.marginRight = '';

    // 상/하 위치
    if (pos.includes('bottom')) {
      c.style.bottom = '52px';
      c.style.top = 'auto';
      c.style.flexDirection = 'column-reverse';
    } else {
      c.style.top = '52px';
      c.style.bottom = 'auto';
      c.style.flexDirection = 'column';
    }

    // 좌/우/중앙 위치 (뷰포트 넘침 방지)
    if (pos.includes('left')) {
      c.style.left = '16px';
      c.style.right = 'auto';
      c.style.alignItems = 'flex-start';
    } else if (pos.includes('right')) {
      c.style.right = '16px';
      c.style.left = 'auto';
      c.style.alignItems = 'flex-end';
    } else {
      c.style.left = '0';
      c.style.right = '0';
      c.style.marginLeft = 'auto';
      c.style.marginRight = 'auto';
      c.style.alignItems = 'center';
    }
    scheduleMpvOverlayStateSync({ force: true });
  }

  // 초기 토스트 위치 적용
  _applyToastPosition(userSettings.getToastPosition());

  // ====== 테마 설정 (앱 설정 모달) ======
  // 라이트 모드 토글
  const lightModeToggle = document.getElementById('appSettingsLightMode');
  function _applyLightMode(enabled) {
    document.documentElement.classList.toggle('light-mode', enabled);
  }
  // 초기 라이트 모드 적용
  _applyLightMode(userSettings.getLightMode());
  if (lightModeToggle) lightModeToggle.checked = userSettings.getLightMode();

  lightModeToggle?.addEventListener('change', (e) => {
    userSettings.setLightMode(e.target.checked);
    _applyLightMode(e.target.checked);
  });

  // 테마 색상 선택
  const themeColorGrid = document.getElementById('appThemeColorGrid');
  function _initThemeGrid() {
    if (!themeColorGrid) return;
    const current = userSettings.getLocalTheme();
    themeColorGrid.querySelectorAll('.theme-color-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === current);
    });
  }
  _initThemeGrid();

  themeColorGrid?.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-color-btn');
    if (!btn) return;
    const theme = btn.dataset.theme;
    themeColorGrid.querySelectorAll('.theme-color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    userSettings.setLocalTheme(theme);
    userSettings.applyTheme(theme);
  });

  // 초기 로컬 테마 적용 (인증 테마보다 우선)
  const savedLocalTheme = userSettings.getLocalTheme();
  if (savedLocalTheme && savedLocalTheme !== 'default') {
    userSettings.applyTheme(savedLocalTheme);
  }

  // ====== 포커스 저장/복원 유틸리티 ======
  let _previousFocusElement = null;

  function saveFocus() {
    _previousFocusElement = document.activeElement;
  }

  function restoreFocus() {
    if (_previousFocusElement && document.contains(_previousFocusElement)) {
      _previousFocusElement.focus();
      _previousFocusElement = null;
    }
  }

  // ====== 로그인 모달 ======
  const loginModal = document.getElementById('loginModal');
  const loginUserDisplay = document.getElementById('loginUserDisplay');
  const loginPasswordInput = document.getElementById('loginPasswordInput');
  const loginHint = document.getElementById('loginHint');
  let _loginTargetName = null;

  function openLoginModal(targetName) {
    saveFocus();
    _loginTargetName = targetName;
    if (loginUserDisplay) loginUserDisplay.textContent = targetName;
    if (loginPasswordInput) loginPasswordInput.value = '';
    if (loginHint) loginHint.textContent = '등록된 사용자입니다. 비밀번호를 입력해주세요.';
    loginModal?.classList.add('active');
    // transitionend 이벤트로 안정적 포커스 이동 (setTimeout 레이스 컨디션 제거)
    const onTransitionEnd = () => {
      loginPasswordInput?.focus();
      loginModal?.removeEventListener('transitionend', onTransitionEnd);
    };
    if (loginModal) {
      loginModal.addEventListener('transitionend', onTransitionEnd, { once: true });
      // transition이 없는 경우를 대비한 폴백
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (document.activeElement !== loginPasswordInput) {
            loginPasswordInput?.focus();
          }
        });
      });
    }
  }

  function closeLoginModalFn() {
    loginModal?.classList.remove('active');
    _loginTargetName = null;
    restoreFocus();
  }

  async function doLogin() {
    if (!_loginTargetName) return;
    const password = loginPasswordInput?.value || '';
    if (!password) {
      showToast('비밀번호를 입력해주세요.', 'warning');
      loginPasswordInput?.focus();
      return;
    }

    try {
      authManager.logout();
      const result = await authManager.login(_loginTargetName, password);
      userSettings.setUserName(_loginTargetName);
      updateUserName(_loginTargetName);

      // 테마 적용
      if (result.theme) {
        userSettings.applyTheme(result.theme);
      } else {
        userSettings.applyThemeForCurrentUser();
      }

      if (result.isAdmin) {
        showToast('관리자로 로그인했습니다.', 'success');
      } else {
        showToast(`"${_loginTargetName}"(으)로 로그인했습니다.`, 'success');
      }
      closeLoginModalFn();

      // 기본 비밀번호(1234) 사용 시 변경 권유
      if (password === '1234') {
        showToast(
          '초기 비밀번호로 로그인했습니다. 보안을 위해 비밀번호를 변경해주세요.',
          'warning',
          5000,
          true
        );
      }
    } catch (error) {
      if (loginHint) {
        loginHint.textContent = error.message;
        loginHint.style.color = '#ff5555';
      }
      loginPasswordInput?.focus();
      loginPasswordInput?.select();
    }
  }

  document.getElementById('confirmLogin')?.addEventListener('click', doLogin);
  document.getElementById('cancelLogin')?.addEventListener('click', closeLoginModalFn);
  document.getElementById('closeLogin')?.addEventListener('click', closeLoginModalFn);
  loginPasswordInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
    else if (e.key === 'Escape') closeLoginModalFn();
  });

  // ====== 비밀번호 변경 모달 ======
  const changePasswordModal = document.getElementById('changePasswordModal');
  const currentPasswordInput = document.getElementById('currentPasswordInput');
  const newPasswordInput = document.getElementById('newPasswordInput');
  const confirmPasswordInput = document.getElementById('confirmPasswordInput');
  const passwordMatchHint = document.getElementById('passwordMatchHint');

  // 비밀번호 일치 여부 실시간 체크
  function checkPasswordMatch() {
    if (!passwordMatchHint) return;
    const newPw = newPasswordInput?.value || '';
    const confirmPw = confirmPasswordInput?.value || '';

    if (!confirmPw) {
      passwordMatchHint.textContent = '';
      passwordMatchHint.className = 'password-match-hint';
      return;
    }

    if (newPw === confirmPw) {
      passwordMatchHint.textContent = '비밀번호가 일치합니다!';
      passwordMatchHint.className = 'password-match-hint match';
    } else {
      passwordMatchHint.textContent = '비밀번호가 일치하지 않습니다.';
      passwordMatchHint.className = 'password-match-hint mismatch';
    }
  }

  newPasswordInput?.addEventListener('input', checkPasswordMatch);
  confirmPasswordInput?.addEventListener('input', checkPasswordMatch);

  function openChangePasswordModal() {
    if (currentPasswordInput) currentPasswordInput.value = '';
    if (newPasswordInput) newPasswordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';
    if (passwordMatchHint) {
      passwordMatchHint.textContent = '';
      passwordMatchHint.className = 'password-match-hint';
    }
    changePasswordModal?.classList.add('active');
    setTimeout(() => currentPasswordInput?.focus(), 100);
  }

  function closeChangePasswordModalFn() {
    changePasswordModal?.classList.remove('active');
  }

  async function doChangePassword() {
    const oldPw = currentPasswordInput?.value || '';
    const newPw = newPasswordInput?.value || '';
    const confirmPw = confirmPasswordInput?.value || '';

    if (!oldPw) {
      showToast('현재 비밀번호를 입력해주세요.', 'warning');
      currentPasswordInput?.focus();
      return;
    }
    if (!newPw) {
      showToast('새 비밀번호를 입력해주세요.', 'warning');
      newPasswordInput?.focus();
      return;
    }
    if (newPw !== confirmPw) {
      showToast('새 비밀번호가 일치하지 않습니다.', 'warning');
      confirmPasswordInput?.focus();
      return;
    }

    try {
      await authManager.changePassword(oldPw, newPw);
      showToast('비밀번호가 변경되었습니다.', 'success');
      closeChangePasswordModalFn();
    } catch (error) {
      showToast(error.message, 'error');
      currentPasswordInput?.focus();
      currentPasswordInput?.select();
    }
  }

  document.getElementById('confirmChangePassword')?.addEventListener('click', doChangePassword);
  document.getElementById('cancelChangePassword')?.addEventListener('click', closeChangePasswordModalFn);
  document.getElementById('closeChangePassword')?.addEventListener('click', closeChangePasswordModalFn);
  confirmPasswordInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doChangePassword(); }
    else if (e.key === 'Escape') closeChangePasswordModalFn();
  });

  // 드롭다운에서 비밀번호 변경 클릭
  document.getElementById('btnChangePassword')?.addEventListener('click', () => {
    commentSettingsDropdown?.classList.remove('open');
    btnCommentSettings?.classList.remove('active');
    openChangePasswordModal();
  });

  // ====== 테마 변경 모달 ======
  const changeThemeModal = document.getElementById('changeThemeModal');
  const changeThemeSelector = document.getElementById('changeThemeSelector');
  let _selectedTheme = '';

  function openChangeThemeModal() {
    // 현재 테마 선택 표시
    const currentTheme = authManager.getCurrentUserTheme() || '';
    _selectedTheme = currentTheme;
    if (changeThemeSelector) {
      changeThemeSelector.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.theme || '') === currentTheme);
      });
    }
    changeThemeModal?.classList.add('active');
  }

  function closeChangeThemeModalFn() {
    changeThemeModal?.classList.remove('active');
  }

  changeThemeSelector?.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-btn');
    if (!btn) return;
    _selectedTheme = btn.dataset.theme || '';
    changeThemeSelector.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  async function doChangeTheme() {
    try {
      const saved = await authManager.changeTheme(_selectedTheme || null);
      if (saved) {
        userSettings.applyTheme(_selectedTheme || 'default');
        showToast('테마가 변경되었습니다.', 'success');
      } else {
        showToast('테마를 변경할 수 없습니다.', 'warning');
      }
      closeChangeThemeModalFn();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  document.getElementById('confirmChangeTheme')?.addEventListener('click', doChangeTheme);
  document.getElementById('cancelChangeTheme')?.addEventListener('click', closeChangeThemeModalFn);
  document.getElementById('closeChangeTheme')?.addEventListener('click', closeChangeThemeModalFn);

  // 드롭다운에서 테마 변경 클릭
  document.getElementById('btnChangeTheme')?.addEventListener('click', () => {
    commentSettingsDropdown?.classList.remove('open');
    btnCommentSettings?.classList.remove('active');
    openChangeThemeModal();
  });

  // ====== 사용자 관리 모달 ======
  const userManagementModal = document.getElementById('userManagementModal');
  const registeredUsersList = document.getElementById('registeredUsersList');

  const THEME_COLOR_MAP = {
    '': '#ffd000',
    'red': '#ff5555',
    'blue': '#4a9eff',
    'pink': '#ffaaaa',
    'green': '#2ed573'
  };

  function renderRegisteredUsers() {
    if (!registeredUsersList) return;
    const users = authManager.getRegisteredUsers();

    if (users.length === 0) {
      registeredUsersList.innerHTML = '<div class="registered-users-empty">등록된 사용자가 없습니다.</div>';
      return;
    }

    registeredUsersList.innerHTML = users.map(u => {
      const themeColor = THEME_COLOR_MAP[u.theme || ''] || '#ffd000';
      const themeName = u.theme ? (u.theme === 'red' ? '빨강' : u.theme === 'blue' ? '파랑' : u.theme === 'pink' ? '핑크' : u.theme === 'green' ? '초록' : '기본') : '기본';
      const initialPwBadge = u.hasInitialPassword
        ? '<span class="initial-password-badge" title="초기 비밀번호(1234) 사용 중">초기PW</span>'
        : '';
      return `
        <div class="registered-user-item" data-name="${u.name}">
          <div class="registered-user-info">
            <span class="registered-user-theme" style="background: ${themeColor};" title="${themeName}"></span>
            <span class="registered-user-name">${u.name}</span>
            ${initialPwBadge}
          </div>
          <button class="registered-user-delete" data-name="${u.name}">삭제</button>
        </div>
      `;
    }).join('');

    // 삭제 버튼 이벤트
    registeredUsersList.querySelectorAll('.registered-user-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const name = e.target.dataset.name;
        if (!name) return;
        const confirmed = confirm(`"${name}" 사용자를 삭제하시겠습니까?\n삭제 후 해당 이름으로 비밀번호 없이 사용할 수 있습니다.`);
        if (!confirmed) return;

        try {
          await authManager.deleteUser(name);
          showToast(`"${name}" 사용자가 삭제되었습니다.`, 'success');
          renderRegisteredUsers();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  }

  function openUserManagementModal() {
    renderRegisteredUsers();
    userManagementModal?.classList.add('active');
  }

  function closeUserManagementModalFn() {
    userManagementModal?.classList.remove('active');
  }

  document.getElementById('closeUserManagement')?.addEventListener('click', closeUserManagementModalFn);
  document.getElementById('closeUserManagementBtn')?.addEventListener('click', closeUserManagementModalFn);

  // Ctrl+Alt+U 단축키로 사용자 관리 모달 열기
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.code === 'KeyU') {
      e.preventDefault();
      openUserManagementModal();
    }
  });

  // ====== 사용자 등록 모달 ======
  const registerUserModal = document.getElementById('registerUserModal');
  const registerNameInput = document.getElementById('registerNameInput');
  const registerThemeSelector = document.getElementById('registerThemeSelector');
  let _registerTheme = '';

  function openRegisterUserModal() {
    if (registerNameInput) registerNameInput.value = '';
    _registerTheme = '';
    if (registerThemeSelector) {
      registerThemeSelector.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.theme || '') === '');
      });
    }
    registerUserModal?.classList.add('active');
    setTimeout(() => registerNameInput?.focus(), 100);
  }

  function closeRegisterUserModalFn() {
    registerUserModal?.classList.remove('active');
  }

  registerThemeSelector?.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-btn');
    if (!btn) return;
    _registerTheme = btn.dataset.theme || '';
    registerThemeSelector.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  async function doRegisterUser() {
    const name = registerNameInput?.value?.trim() || '';
    if (!name) {
      showToast('이름을 입력해주세요.', 'warning');
      registerNameInput?.focus();
      return;
    }

    try {
      await authManager.registerUser(name, _registerTheme || null);
      showToast(`"${name}" 사용자가 등록되었습니다. (초기 비밀번호: 1234)`, 'success');
      closeRegisterUserModalFn();
      renderRegisteredUsers(); // 사용자 관리 목록 갱신
    } catch (error) {
      showToast(error.message, 'error');
      registerNameInput?.focus();
    }
  }

  document.getElementById('btnOpenRegisterUser')?.addEventListener('click', openRegisterUserModal);
  document.getElementById('confirmRegisterUser')?.addEventListener('click', doRegisterUser);
  document.getElementById('cancelRegisterUser')?.addEventListener('click', closeRegisterUserModalFn);
  document.getElementById('closeRegisterUser')?.addEventListener('click', closeRegisterUserModalFn);
  registerNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doRegisterUser(); }
    else if (e.key === 'Escape') closeRegisterUserModalFn();
  });

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
    threadReplies.innerHTML = (marker.replies || []).map(reply => {
      const canEditReply = commentManager.canEdit(reply);
      return `
      <div class="thread-reply-item" data-reply-id="${reply.id}">
        <div class="thread-reply-avatar">${escapeHtml(reply.author.charAt(0))}</div>
        <div class="thread-reply-content">
          <div class="thread-reply-header">
            <span class="thread-reply-author" ${getAuthorColorStyle(reply.author)}>${escapeHtml(reply.author)}</span>
            <span class="thread-reply-time">${formatRelativeTime(reply.createdAt)}</span>
            ${canEditReply ? `
            <div class="thread-reply-actions">
              <button class="thread-reply-action-btn thread-reply-edit-btn" title="수정">수정</button>
              <button class="thread-reply-action-btn thread-reply-delete-btn" title="삭제">삭제</button>
            </div>
            ` : ''}
          </div>
          <div class="thread-reply-text">${formatMarkdown(reply.text)}</div>
          ${reply.image ? `<div class="thread-reply-image"><img src="${reply.image}" alt="첨부 이미지" data-full-image="${reply.image}"></div>` : ''}
        </div>
      </div>
    `;
    }).join('');

    // 답글 수정/삭제 이벤트 바인딩
    bindThreadReplyActions(markerId);

    // 에디터 초기화
    threadEditor.innerHTML = '';
    updateSubmitButtonState();
    resizeReplyEditorToContent(threadEditor);

    // 멘션 자동완성 부착
    mentionManager.attach(threadEditor);

    // 팝업 열기 (이전 포커스 저장)
    saveFocus();
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
    resizeReplyEditorToContent(threadEditor);
    clearThreadImage();
    restoreFocus();
  }

  /**
   * 스레드 답글 수정/삭제 이벤트 바인딩 (공통 헬퍼 사용)
   */
  const _threadEditConfig = {
    textSelector: '.thread-reply-text',
    editorType: 'contenteditable',
    editorClass: 'thread-reply-edit-editor',
    formClass: 'thread-reply-edit-form',
    actionsClass: 'thread-reply-edit-actions',
    saveClass: 'thread-reply-edit-save',
    cancelClass: 'thread-reply-edit-cancel'
  };

  function updateThreadReplyCount(markerId) {
    const marker = commentManager.getMarker(markerId);
    const replyCount = marker?.replies?.length || 0;
    threadReplyCount.textContent = replyCount > 0 ? `${replyCount}개의 댓글` : '';
    threadReplyCount.style.display = replyCount > 0 ? 'flex' : 'none';
  }

  function bindThreadReplyActions(markerId) {
    threadReplies.querySelectorAll('.thread-reply-item').forEach(replyItem => {
      const replyId = replyItem.dataset.replyId;
      if (!replyId) return;

      // 이미 바인딩된 요소 건너뛰기
      if (replyItem.dataset.bound) return;
      replyItem.dataset.bound = 'true';

      // 수정 버튼
      replyItem.querySelector('.thread-reply-edit-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        startReplyEdit(replyItem, markerId, replyId, _threadEditConfig, (newText) => {
          // 스레드 팝업은 별도 렌더링 경로라서 수동으로 텍스트 갱신
          const textEl = replyItem.querySelector('.thread-reply-text');
          if (textEl) textEl.innerHTML = formatMarkdown(newText);
        });
      });

      // 삭제 버튼
      replyItem.querySelector('.thread-reply-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        handleReplyDelete(markerId, replyId, () => {
          replyItem.remove();
          updateThreadReplyCount(markerId);
        });
      });
    });
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

    // Code: `code` — 플레이스홀더로 보호 (멘션 하이라이팅 방지)
    const codePlaceholders = [];
    html = html.replace(/`([^`]+)`/g, (_, code) => {
      const placeholder = `\x00CODE_${codePlaceholders.length}\x00`;
      codePlaceholders.push(`<code>${code}</code>`);
      return placeholder;
    });

    // Bullet list: - item
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    // Clean up consecutive ul tags
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    // @멘션 하이라이팅 (TEAM_MEMBERS 이름만)
    const names = TEAM_MEMBERS.map(m => m.name).sort((a, b) => b.length - a.length);
    const mentionPattern = new RegExp(`@(${names.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
    html = html.replace(mentionPattern, '<span class="mention-highlight">@$1</span>');

    // 코드 블록 복원
    codePlaceholders.forEach((code, i) => {
      html = html.replace(`\x00CODE_${i}\x00`, code);
    });

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    // G:/ 경로 링크 변환
    html = renderGDriveLinks(html);

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
    // 주의: innerHTML += 를 쓰면 기존 DOM이 재파싱되면서 이벤트 리스너가
    //       사라지고 data-bound 속성은 남아 이전 답글의 수정/삭제가 먹통됨
    //       → insertAdjacentHTML로 기존 노드를 건드리지 않고 append
    threadReplies.insertAdjacentHTML('beforeend', `
      <div class="thread-reply-item" data-reply-id="${newReply.id}">
        <div class="thread-reply-avatar">${escapeHtml(newReply.author.charAt(0))}</div>
        <div class="thread-reply-content">
          <div class="thread-reply-header">
            <span class="thread-reply-author" ${getAuthorColorStyle(newReply.author)}>${escapeHtml(newReply.author)}</span>
            <span class="thread-reply-time">${formatRelativeTime(newReply.createdAt)}</span>
            <div class="thread-reply-actions">
              <button class="thread-reply-action-btn thread-reply-edit-btn" title="수정">수정</button>
              <button class="thread-reply-action-btn thread-reply-delete-btn" title="삭제">삭제</button>
            </div>
          </div>
          <div class="thread-reply-text">${formatMarkdown(newReply.text)}</div>
          ${newReply.image ? `<div class="thread-reply-image"><img src="${newReply.image}" alt="첨부 이미지" data-full-image="${newReply.image}"></div>` : ''}
        </div>
      </div>
    `);

    // 새 답글에만 이벤트 바인딩 (기존 답글은 data-bound로 스킵)
    bindThreadReplyActions(currentThreadMarkerId);

    // 에디터 및 이미지 초기화
    threadEditor.innerHTML = '';
    resizeReplyEditorToContent(threadEditor);
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
    // Enter: Submit (without Shift) — 멘션 드롭다운 열려있으면 무시
    if (e.key === 'Enter' && !e.shiftKey && !mentionManager.isVisible) {
      e.preventDefault();
      submitThreadReply();
    }
  });

  // 에디터 내용 변경 감지
  threadEditor?.addEventListener('input', () => {
    updateSubmitButtonState();
    resizeReplyEditorToContent(threadEditor);

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
  // 이미지가 있으면 동기적으로 preventDefault (async await 이후엔 이미 늦음)
  threadEditor?.addEventListener('paste', async (e) => {
    // 드라이브 경로 자동 따옴표
    if (handleDrivePathPaste(e)) return;

    if (!hasImageInClipboard(e)) return;
    e.preventDefault();

    const imageData = await getImageFromClipboard(e);
    if (imageData) {
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
    commentSettingsDropdown?.classList.remove('open');
    btnCommentSettings?.classList.remove('active');
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
  const btnWindowsIntegrationRepair = document.getElementById('btnWindowsIntegrationRepair');

  async function runWindowsIntegrationRepairFlow() {
    commentSettingsDropdown?.classList.remove('open');
    btnCommentSettings?.classList.remove('active');

    if (!window.platform?.isWindows) {
      showToast('Windows에서만 사용할 수 있는 기능입니다.', 'warning', 4000, true);
      return;
    }

    try {
      const detectResult = await window.electronAPI.detectWindowsIntegration?.();
      if (!detectResult?.success) {
        showToast(`통합 상태 확인 실패: ${detectResult?.error || '알 수 없는 오류'}`, 'error', 5000, true);
        return;
      }

      if (!detectResult.installer?.exists) {
        showToast('통합 설치기를 찾을 수 없습니다. integration/installer 폴더를 확인해주세요.', 'error', 6000, true);
        return;
      }

      if (detectResult.integrationStatus?.installed) {
        const proceed = confirm('Windows 통합이 이미 설치된 것으로 보입니다. 복구(재설치)를 계속할까요?');
        if (!proceed) {
          return;
        }
      }

      const repairResult = await window.electronAPI.runWindowsIntegrationRepair?.();
      if (repairResult?.success) {
        showToast('Windows 통합 설치기를 실행했습니다. 관리자 권한 승인 후 설치를 진행하세요.', 'info', 6000, true);
      } else {
        const message = repairResult?.error || '설치기 실행 실패';
        const isCancelled = /cancel|취소/i.test(message);
        if (isCancelled) {
          showToast('관리자 권한 요청이 취소되었습니다.', 'warning', 5000, true);
        } else {
          showToast(`통합 복구 실행 실패: ${message}`, 'error', 6000, true);
        }
      }
    } catch (error) {
      showToast(`통합 복구 실행 중 오류: ${error.message}`, 'error', 6000, true);
    }
  }
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
  btnWindowsIntegrationRepair?.addEventListener('click', runWindowsIntegrationRepairFlow);

  btnCacheSettings?.addEventListener('click', () => {
    commentSettingsDropdown?.classList.remove('open');
    btnCommentSettings?.classList.remove('active');
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
  versionDropdown.onFeedbackImport(handleImportFeedbackFromVersion);

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

  // ====== 사용자 연결 플렉서스 패널 관련 ======
  let _collabPanelHoverTimer = null;
  let _currentCollaborators = [];
  let _plexusAnimationId = null;
  let _plexusTime = 0;
  let _plexusNodePositions = []; // 각 사용자 노드의 현재 위치
  const _plexusFlowParticles = []; // 연결선 위 이동 파티클

  /**
   * 협업자 UI 업데이트
   */
  function updateCollaboratorsUI(collaborators) {
    if (!collaboratorsIndicator) return;

    _currentCollaborators = collaborators;

    if (collaborators.length === 0) {
      collaboratorsIndicator.style.display = 'none';
      _hideCollabPlexusPanel();
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

  let _plexusStartTimer = null;

  /**
   * 사용자 노드 위치 계산 (원형 배치 + 부드러운 떠다님)
   */
  function _calculateNodePositions(w, h, count, time) {
    const positions = [];
    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.min(w, h) * 0.3;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      // breathing 애니메이션 (각 노드마다 다른 위상)
      const breathX = Math.sin(time * 0.008 + i * 1.7) * 6;
      const breathY = Math.cos(time * 0.006 + i * 2.3) * 4;
      positions.push({
        x: centerX + Math.cos(angle) * radius + breathX,
        y: centerY + Math.sin(angle) * radius + breathY
      });
    }
    return positions;
  }

  /**
   * 사용자 노드 네트워크 그래프 렌더링
   */
  function _drawUserPlexus(ctx, w, h, collaborators, time) {
    ctx.clearRect(0, 0, w, h);
    if (collaborators.length === 0) return;

    const positions = _calculateNodePositions(w, h, collaborators.length, time);
    _plexusNodePositions = positions;
    const nodeRadius = 18;

    // 동기화 중인 사용자 확인
    const hasSyncUsers = collaborators.some(c => c.syncActive);

    // 1. 연결선 그리기 (모든 노드 쌍)
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const p1 = positions[i];
        const p2 = positions[j];
        const c1 = collaborators[i].color || '#ffd000';
        const c2 = collaborators[j].color || '#ffd000';
        const bothSyncing = collaborators[i].syncActive && collaborators[j].syncActive;

        if (bothSyncing) {
          // ===== 동기화 연결: 에너지 빔 =====
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // 넓은 에너지 필드 (배경)
          const beamGrad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
          beamGrad.addColorStop(0, c1);
          beamGrad.addColorStop(0.5, '#ffffff');
          beamGrad.addColorStop(1, c2);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = beamGrad;
          ctx.lineWidth = 3;
          ctx.globalAlpha = 0.15 + Math.sin(time * 0.04 + i) * 0.05;
          ctx.stroke();

          // 중심 에너지 라인 (실선, 밝음)
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = beamGrad;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.5 + Math.sin(time * 0.03 + i + j) * 0.2;
          ctx.stroke();
          ctx.globalAlpha = 1;

          // 에너지 파티클 (더 많고, 더 빠르고, 꼬리 있음)
          const beamParticles = 4;
          for (let k = 0; k < beamParticles; k++) {
            const t = ((time * 0.012 + k / beamParticles + i * 0.2) % 1);
            const px = p1.x + dx * t;
            const py = p1.y + dy * t;
            const glow = 0.5 + Math.sin(t * Math.PI) * 0.5;
            const size = 2 + Math.sin(t * Math.PI) * 1.5;

            // 파티클 트레일 (꼬리)
            const trailLen = 0.08;
            const t2 = Math.max(0, t - trailLen);
            const tx = p1.x + dx * t2;
            const ty = p1.y + dy * t2;
            const trailGrad = ctx.createLinearGradient(tx, ty, px, py);
            trailGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
            trailGrad.addColorStop(1, `rgba(255, 255, 255, ${glow * 0.6})`);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(px, py);
            ctx.strokeStyle = trailGrad;
            ctx.lineWidth = size * 0.8;
            ctx.stroke();

            // 파티클 헤드
            ctx.beginPath();
            ctx.arc(px, py, size, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = glow;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        } else {
          // ===== 일반 연결: 기존 점선 =====
          const gradient = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
          gradient.addColorStop(0, c1);
          gradient.addColorStop(1, c2);

          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.3 + Math.sin(time * 0.02 + i + j) * 0.1;
          ctx.setLineDash([4, 4]);
          ctx.lineDashOffset = -time * 0.3;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;

          // 연결선 위 이동 파티클
          for (let k = 0; k < 2; k++) {
            const t = ((time * 0.005 + k * 0.5 + i * 0.3 + j * 0.7) % 1);
            const px = p1.x + (p2.x - p1.x) * t;
            const py = p1.y + (p2.y - p1.y) * t;
            const particleGlow = 0.4 + Math.sin(t * Math.PI) * 0.4;
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.globalAlpha = particleGlow;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      }
    }

    // 2. 노드 그리기
    for (let i = 0; i < collaborators.length; i++) {
      const pos = positions[i];
      const collab = collaborators[i];
      const color = collab.color || '#ffd000';
      const isSyncing = collab.syncActive;

      if (isSyncing) {
        // ===== 동기화 노드: 궤도 링 + 코멧 파티클 =====

        // 외곽 궤도 링 1 (빠른 회전)
        const orbitR1 = nodeRadius + 10;
        const orbitAngle1 = time * 0.03 + i * 1.5;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, orbitR1, orbitAngle1, orbitAngle1 + Math.PI * 1.2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // 외곽 궤도 링 2 (반대 방향, 느림)
        const orbitR2 = nodeRadius + 14;
        const orbitAngle2 = -time * 0.02 + i * 2.1;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, orbitR2, orbitAngle2, orbitAngle2 + Math.PI * 0.8);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // 코멧 파티클 (궤도 위 회전)
        const cometCount = 3;
        for (let c = 0; c < cometCount; c++) {
          const cAngle = time * 0.04 + c * (Math.PI * 2 / cometCount) + i * 1.2;
          const cR = nodeRadius + 10 + Math.sin(time * 0.02 + c) * 2;
          const cx = pos.x + Math.cos(cAngle) * cR;
          const cy = pos.y + Math.sin(cAngle) * cR;

          // 코멧 트레일
          const trailArc = 0.5;
          const trailStartAngle = cAngle - trailArc;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, cR, trailStartAngle, cAngle);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.3;
          ctx.stroke();
          ctx.globalAlpha = 1;

          // 코멧 헤드
          ctx.beginPath();
          ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.9;
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // 노드 배경 (약간 더 밝게)
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // 노드 테두리 (밝은 흰색)
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 동기화 아이콘 배지 (기존 초록 점 대신)
        const badgeX = pos.x + nodeRadius * 0.6;
        const badgeY = pos.y - nodeRadius * 0.6;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        // 작은 화살표 (동기화 심볼)
        ctx.fillStyle = color;
        ctx.font = 'bold 7px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u21BB', badgeX, badgeY + 0.5); // ↻ 회전 화살표

      } else {
        // ===== 일반 노드 =====
        // 글로우 효과
        const glowIntensity = 0.3 + Math.sin(time * 0.015 + i * 2) * 0.15;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius + 6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = glowIntensity;
        ctx.fill();
        ctx.globalAlpha = 1;

        // 노드 배경
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // 노드 테두리
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 온라인 상태 인디케이터
        const statusX = pos.x + nodeRadius * 0.6;
        const statusY = pos.y - nodeRadius * 0.6;
        ctx.beginPath();
        ctx.arc(statusX, statusY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#2ed573';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(statusX, statusY, 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 이니셜 텍스트
      const initials = collab.name.substring(0, 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.font = 'bold 11px "Pretendard Variable", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials, pos.x, pos.y);

      // 이름 레이블 (노드 아래)
      ctx.fillStyle = isSyncing ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.8)';
      ctx.font = isSyncing ? 'bold 10px "Pretendard Variable", sans-serif' : '10px "Pretendard Variable", sans-serif';
      const label = collab.isMe ? `${collab.name} (나)` : collab.name;
      ctx.fillText(label, pos.x, pos.y + nodeRadius + 14);

      // 동기화 사용자: 이름 아래 "동기화 중" 라벨
      if (isSyncing) {
        ctx.fillStyle = color;
        ctx.font = '8px "Pretendard Variable", sans-serif';
        ctx.fillText('동기화 중', pos.x, pos.y + nodeRadius + 25);
      }
    }
  }

  function _startPlexusAnimation() {
    if (_plexusAnimationId) return;

    const canvas = elements.collabPlexusCanvas;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    function animate() {
      _plexusTime++;
      const rect = canvas.parentElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        _drawUserPlexus(ctx, rect.width, rect.height, _currentCollaborators, _plexusTime);
      }
      _plexusAnimationId = requestAnimationFrame(animate);
    }

    animate();
  }

  function _stopPlexusAnimation() {
    if (_plexusAnimationId) {
      cancelAnimationFrame(_plexusAnimationId);
      _plexusAnimationId = null;
    }
  }

  function _showCollabPlexusPanel() {
    const panel = elements.collabPlexusPanel;
    if (!panel || _currentCollaborators.length === 0) return;

    // 설정에서 비활성화된 경우
    if (!userSettings.settings.showPlexusPanel) return;

    panel.classList.add('active');

    // 이전 타이머 정리
    if (_plexusStartTimer) {
      clearTimeout(_plexusStartTimer);
    }

    // CSS transition 완료 후 애니메이션 시작 (height: 0→240px, transition 350ms)
    _plexusStartTimer = setTimeout(() => {
      _startPlexusAnimation();
    }, 380);
  }

  function _hideCollabPlexusPanel() {
    const panel = elements.collabPlexusPanel;
    if (!panel) return;

    // 시작 타이머 정리
    if (_plexusStartTimer) {
      clearTimeout(_plexusStartTimer);
      _plexusStartTimer = null;
    }

    panel.classList.remove('active');
    _stopPlexusAnimation();
  }

  // 호버 이벤트 설정
  collaboratorsIndicator?.addEventListener('mouseenter', () => {
    clearTimeout(_collabPanelHoverTimer);
    _collabPanelHoverTimer = setTimeout(() => {
      _showCollabPlexusPanel();
    }, 200); // 200ms 딜레이 (오발 방지)
  });

  collaboratorsIndicator?.addEventListener('mouseleave', (e) => {
    clearTimeout(_collabPanelHoverTimer);
    // 패널로 마우스가 이동한 경우 숨기지 않음
    const panel = elements.collabPlexusPanel;
    if (panel && panel.contains(e.relatedTarget)) return;

    _collabPanelHoverTimer = setTimeout(() => {
      _hideCollabPlexusPanel();
    }, 300);
  });

  elements.collabPlexusPanel?.addEventListener('mouseenter', () => {
    clearTimeout(_collabPanelHoverTimer);
  });

  elements.collabPlexusPanel?.addEventListener('mouseleave', () => {
    clearTimeout(_collabPanelHoverTimer);
    _collabPanelHoverTimer = setTimeout(() => {
      _hideCollabPlexusPanel();
    }, 300);
  });

  // ====== 협업 연결 리플 효과 (캔버스 기반 화면 왜곡) ======
  let _rippleAnimationId = null;

  function _triggerCollabRipple() {
    const canvas = document.getElementById('collabRippleCanvas');
    if (!canvas) return;

    // 이전 애니메이션 정리
    if (_rippleAnimationId) {
      cancelAnimationFrame(_rippleAnimationId);
      _rippleAnimationId = null;
    }

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.classList.add('active');

    // 인디케이터 위치에서 시작
    let originX = canvas.width / 2;
    let originY = 0;
    if (collaboratorsIndicator) {
      const rect = collaboratorsIndicator.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
    }

    const maxRadius = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height);
    const duration = 1800; // 1.8초
    const startTime = performance.now();

    // 3개의 파동 (시차 발사)
    const waves = [
      { delay: 0, thickness: 80, color: [255, 208, 0] },     // 골드
      { delay: 120, thickness: 60, color: [255, 180, 40] },   // 오렌지
      { delay: 280, thickness: 40, color: [255, 220, 100] }   // 밝은 골드
    ];

    function animateRipple(now) {
      const elapsed = now - startTime;
      if (elapsed > duration + 400) {
        canvas.classList.remove('active');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        _rippleAnimationId = null;
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const wave of waves) {
        const waveElapsed = elapsed - wave.delay;
        if (waveElapsed < 0) continue;

        const progress = Math.min(waveElapsed / duration, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const radius = eased * maxRadius;
        const thickness = wave.thickness * (1 - progress * 0.5);

        // 페이드: 등장 → 유지 → 페이드아웃
        let alpha;
        if (progress < 0.1) {
          alpha = progress / 0.1;
        } else if (progress < 0.4) {
          alpha = 1;
        } else {
          alpha = 1 - (progress - 0.4) / 0.6;
        }
        alpha *= 0.35;

        const [r, g, b] = wave.color;

        // 외곽 글로우 (넓은 반투명)
        const glowGrad = ctx.createRadialGradient(
          originX, originY, Math.max(0, radius - thickness * 2),
          originX, originY, radius + thickness
        );
        glowGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        glowGrad.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`);
        glowGrad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${alpha * 0.6})`);
        glowGrad.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`);
        glowGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

        ctx.beginPath();
        ctx.arc(originX, originY, radius + thickness, 0, Math.PI * 2);
        ctx.fillStyle = glowGrad;
        ctx.fill();

        // 선명한 중심 링
        ctx.beginPath();
        ctx.arc(originX, originY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.8})`;
        ctx.lineWidth = 2 * (1 - progress * 0.7);
        ctx.stroke();

        // 내부 빛 산란 효과 (screen-like glow)
        if (progress < 0.6) {
          const innerGrad = ctx.createRadialGradient(
            originX, originY, 0,
            originX, originY, radius * 0.5
          );
          const innerAlpha = alpha * 0.15 * (1 - progress / 0.6);
          innerGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${innerAlpha})`);
          innerGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.beginPath();
          ctx.arc(originX, originY, radius * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = innerGrad;
          ctx.fill();
        }
      }

      // 중앙 플래시 (초반에만)
      const flashProgress = elapsed / 300;
      if (flashProgress < 1) {
        const flashAlpha = 0.4 * (1 - flashProgress);
        const flashRadius = 30 + flashProgress * 60;
        const flashGrad = ctx.createRadialGradient(
          originX, originY, 0,
          originX, originY, flashRadius
        );
        flashGrad.addColorStop(0, `rgba(255, 240, 200, ${flashAlpha})`);
        flashGrad.addColorStop(0.5, `rgba(255, 208, 0, ${flashAlpha * 0.5})`);
        flashGrad.addColorStop(1, 'rgba(255, 208, 0, 0)');
        ctx.beginPath();
        ctx.arc(originX, originY, flashRadius, 0, Math.PI * 2);
        ctx.fillStyle = flashGrad;
        ctx.fill();
      }

      _rippleAnimationId = requestAnimationFrame(animateRipple);
    }

    _rippleAnimationId = requestAnimationFrame(animateRipple);
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

  /**
   * 원격 커서 렌더링
   */
  remoteCursorsContainer = (() => {
    let container = document.getElementById('remoteCursorsContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'remoteCursorsContainer';
      container.className = 'remote-cursors-container';
      elements.videoWrapper?.appendChild(container);
    }
    return container;
  })();
  let lastRemoteCursorCollaborators = [];

  function clearRemoteCursors() {
    if (!remoteCursorsContainer) return;
    remoteCursorsContainer.querySelectorAll('.remote-cursor').forEach(el => el.remove());
    scheduleMpvOverlayRemoteCursorStateSync();
  }

  function createRemoteCursorElement(collab) {
    const cursorEl = document.createElement('div');
    cursorEl.id = `cursor-${collab.connectionId}`;
    cursorEl.className = 'remote-cursor';

    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.classList.add('remote-cursor-icon');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');

    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', 'M1 1L6 14L8 8L14 6L1 1Z');
    path.setAttribute('fill', collab.userColor || '#ffd000');
    path.setAttribute('stroke', 'rgba(0,0,0,0.3)');
    path.setAttribute('stroke-width', '0.5');
    svg.appendChild(path);

    const label = document.createElement('span');
    label.className = 'remote-cursor-label';
    label.style.backgroundColor = collab.userColor || '#ffd000';
    label.textContent = collab.userName || '알 수 없음';

    cursorEl.appendChild(svg);
    cursorEl.appendChild(label);
    return cursorEl;
  }

  function renderRemoteCursors(collaborators = []) {
    if (!remoteCursorsContainer) return;

    const safeCollaborators = Array.isArray(collaborators) ? collaborators : [];
    lastRemoteCursorCollaborators = safeCollaborators;

    if (!userSettings.getShowRemoteCursors()) {
      clearRemoteCursors();
      return;
    }

    // 기존 커서 중 더 이상 없는 것 제거
    const activeIds = new Set(safeCollaborators.filter(c => c.cursor).map(c => `cursor-${c.connectionId}`));
    remoteCursorsContainer.querySelectorAll('.remote-cursor').forEach(el => {
      if (!activeIds.has(el.id)) el.remove();
    });

    for (const collab of safeCollaborators) {
      if (!collab.cursor) continue;

      const cursorId = `cursor-${collab.connectionId}`;
      let cursorEl = document.getElementById(cursorId);

      if (!cursorEl) {
        cursorEl = createRemoteCursorElement(collab);
        remoteCursorsContainer.appendChild(cursorEl);
      }

      // 정규화 좌표를 실제 픽셀로 변환
      const wrapperRect = elements.videoWrapper?.getBoundingClientRect();
      if (wrapperRect) {
        const x = collab.cursor.x * wrapperRect.width;
        const y = collab.cursor.y * wrapperRect.height;
        cursorEl.style.transform = `translate(${x}px, ${y}px)`;
        cursorEl.style.display = 'block';
      }
    }
    scheduleMpvOverlayRemoteCursorStateSync();
  }

  userSettings.addEventListener('showRemoteCursorsChanged', (event) => {
    updateRemoteCursorToggleButton();
    if (event.detail?.show) {
      renderRemoteCursors(lastRemoteCursorCollaborators);
    } else {
      clearRemoteCursors();
    }
  });

  // 로컬 커서 → Presence 전송 (videoWrapper 위에서만)
  elements.videoWrapper?.addEventListener('mousemove', (e) => {
    if (!liveblocksManager.isConnected) return;
    const rect = elements.videoWrapper.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    liveblocksManager.updatePresence({ cursor: { x, y } });
  });

  elements.videoWrapper?.addEventListener('mouseleave', () => {
    if (!liveblocksManager.isConnected) return;
    liveblocksManager.updatePresence({ cursor: null });
  });

  /**
   * 타임라인에 원격 재생헤드 표시
   */
  function renderRemotePlayheads(collaborators) {
    const timelineTracks = document.getElementById('timelineTracks');
    if (!timelineTracks) return;

    // 기존 원격 플레이헤드 제거
    timelineTracks.querySelectorAll('.remote-playhead').forEach(el => el.remove());

    if (!timeline.duration || timeline.duration <= 0) return;

    const tracksContainer = document.getElementById('tracksContainer');
    const containerWidth = tracksContainer?.offsetWidth || timelineTracks.offsetWidth || 1000;

    for (const collab of collaborators) {
      if (collab.currentFrame === null || collab.currentFrame === undefined) continue;

      const fps = timeline.fps || 24;
      const time = collab.currentFrame / fps;
      const percent = time / timeline.duration;
      const positionPx = percent * containerWidth;

      const line = document.createElement('div');
      line.className = 'remote-playhead';
      line.style.left = `${positionPx}px`;
      line.style.borderColor = collab.userColor;
      line.title = collab.userName;

      const label = document.createElement('span');
      label.className = 'remote-playhead-label';
      label.style.backgroundColor = collab.userColor;
      label.textContent = collab.userName.substring(0, 2);
      line.appendChild(label);

      timelineTracks.appendChild(line);
    }
  }

  // Liveblocks 협업 이벤트 리스너
  let _previousOthersCount = 0;
  liveblocksManager.addEventListener('collaboratorsChanged', (e) => {
    // 자기 자신 + 다른 사용자 모두 표시
    const isSyncing = playbackSync.syncEnabled;
    const me = {
      name: userSettings.getUserName(),
      color: userSettings.getColorForName(userSettings.getUserName()) || '#4a9eff',
      isMe: true,
      syncActive: isSyncing
    };
    const others = e.detail.collaborators.map(c => ({
      name: c.userName,
      color: c.userColor,
      isMe: false,
      syncActive: isSyncing // 동기화 활성화 시 모든 참여자 동기화 상태
    }));
    updateCollaboratorsUI([me, ...others]);

    // 다른 사용자가 새로 참여했을 때 리플 효과 (0→1 이상)
    const currentOthersCount = others.length;
    if (currentOthersCount > 0 && _previousOthersCount === 0) {
      showToast('실시간 협업 세션에 참여했습니다', 'info');
      _triggerCollabRipple();
    }
    _previousOthersCount = currentOthersCount;

    // 원격 커서 렌더링
    renderRemoteCursors(e.detail.collaborators);

    // 타임라인에 원격 재생헤드 표시
    renderRemotePlayheads(e.detail.collaborators);
  });

  liveblocksManager.addEventListener('collaborationStarted', (e) => {
    log.info('협업 시작됨 (Liveblocks)', e.detail);
    // 다른 협업자가 있을 때만 알림 표시 (단일 세션에서는 무시)
    if (liveblocksManager.hasOtherCollaborators()) {
      if (!e.detail.isNewRoom) {
        showToast('실시간 협업 세션에 참여했습니다', 'info');
      }
      // AirDrop 스타일 리플 효과
      _triggerCollabRipple();
    }
  });

  liveblocksManager.addEventListener('connectionStatusChanged', (e) => {
    const { status } = e.detail;
    if (status === 'connected') {
      updateSyncStatusUI('synced');
      setTimeout(() => updateSyncStatusUI(''), 3000);
    } else if (status === 'reconnecting') {
      updateSyncStatusUI('syncing');
    } else if (status === 'disconnected') {
      updateSyncStatusUI('error');
    }
  });

  // 수동 동기화 버튼 → Liveblocks에서는 항상 실시간이므로 상태 표시만
  syncStatus?.addEventListener('click', () => {
    if (!liveblocksManager.hasOtherCollaborators()) {
      showToast('다른 협업자가 없습니다', 'info');
      return;
    }
    showToast('실시간 동기화 중입니다', 'info');
  });

  // ====== 재생 동기화 UI 초기화 ======
  const syncPanel = document.getElementById('playbackSyncPanel');
  const chkPlaybackSync = document.getElementById('chkPlaybackSync');
  const lblPlaybackSyncStatus = document.getElementById('lblPlaybackSyncStatus');
  const btnPlaybackSyncClose = document.getElementById('btnPlaybackSyncClose');
  const playbackSyncStatusInfo = document.getElementById('playbackSyncStatusInfo');
  const syncModeRadios = document.querySelectorAll('input[name="syncLeaderMode"]');

  function updateSyncPanelStatus() {
    const dot = playbackSyncStatusInfo?.querySelector('.playback-sync-dot');
    const statusText = playbackSyncStatusInfo?.querySelector('.playback-sync-status-text');
    if (!dot || !statusText) return;

    dot.classList.remove('active', 'leading');

    if (!playbackSync.syncEnabled) {
      statusText.textContent = '동기화 꺼짐';
    } else if (playbackSync.leaderMode === 'lead') {
      dot.classList.add('leading');
      statusText.textContent = '내가 주도 중';
    } else {
      dot.classList.add('active');
      statusText.textContent = '팔로잉 중';
    }
  }

  // 협업 시작 시 동기화 패널 표시
  liveblocksManager.addEventListener('collaborationStarted', () => {
    if (syncPanel) syncPanel.style.display = '';
  });

  // 동기화 토글
  chkPlaybackSync?.addEventListener('change', (e) => {
    playbackSync.setSyncEnabled(e.target.checked);
    lblPlaybackSyncStatus.textContent = e.target.checked ? '동기화 켜짐' : '동기화 꺼짐';
    updateSyncPanelStatus();
    // 플렉서스에서 동기화 상태 반영
    _currentCollaborators.forEach(c => { c.syncActive = e.target.checked; });
  });

  // 리더 모드 변경
  syncModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      playbackSync.setLeaderMode(e.target.value);
      updateSyncPanelStatus();
    });
  });

  // 패널 닫기
  btnPlaybackSyncClose?.addEventListener('click', () => {
    if (syncPanel) syncPanel.style.display = 'none';
  });

  // 플렉서스 패널에서 동기화 패널 열기
  document.getElementById('btnOpenSyncFromPlexus')?.addEventListener('click', () => {
    if (syncPanel) syncPanel.style.display = '';
  });

  // 패널 접기/펼치기
  const btnPlaybackSyncCollapse = document.getElementById('btnPlaybackSyncCollapse');
  btnPlaybackSyncCollapse?.addEventListener('click', () => {
    syncPanel?.classList.toggle('collapsed');
  });

  // 패널 드래그 이동
  const playbackSyncHeader = document.getElementById('playbackSyncHeader');
  if (playbackSyncHeader && syncPanel) {
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartX = 0;
    let panelStartY = 0;

    playbackSyncHeader.addEventListener('mousedown', (e) => {
      // 버튼 클릭은 드래그로 처리하지 않음
      if (e.target.closest('button')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = syncPanel.getBoundingClientRect();
      panelStartX = rect.left;
      panelStartY = rect.top;
      syncPanel.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const newX = panelStartX + dx;
      const newY = panelStartY + dy;
      // position을 fixed left/top으로 전환
      syncPanel.style.right = 'auto';
      syncPanel.style.bottom = 'auto';
      syncPanel.style.left = `${Math.max(0, Math.min(newX, window.innerWidth - syncPanel.offsetWidth))}px`;
      syncPanel.style.top = `${Math.max(0, Math.min(newY, window.innerHeight - syncPanel.offsetHeight))}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      syncPanel.classList.remove('dragging');
    });
  }

  function canHandleRemoteContinuousSync() {
    return playlistUIState.mode === 'continuous' && timeline.playlistDuration > 0;
  }

  function warnRemoteContinuousSyncUnavailable(action, time) {
    log.warn('리모트 연속 재생 동기화를 처리할 수 없습니다', {
      action,
      time,
      mode: playlistUIState.mode,
      playlistDuration: timeline.playlistDuration
    });
    showToast('상대방의 재생목록 위치를 따라갈 수 없습니다.', 'warning');
  }

  // 리모트 이벤트 수신 → 로컬 재생 제어
  playbackSync.addEventListener('remotePlay', (e) => {
    const { time, playlistContinuous } = e.detail;
    if (playlistContinuous) {
      if (!canHandleRemoteContinuousSync()) {
        warnRemoteContinuousSyncUnavailable('play', time);
        return;
      }
      void (async () => {
        const followed = await seekContinuousTimeline(time);
        if (!followed) {
          log.warn('리모트 연속 재생 위치를 따라갈 수 없습니다', { time });
          showToast('상대방의 재생목록 위치를 따라갈 수 없습니다.', 'warning');
          return;
        }
        if (!continuousPlaybackState.active) {
          await startContinuousPlayback();
          return;
        }
        await playVideoAfterMediaLoad({ silent: true, logContext: { remoteContinuousPlay: true } });
      })();
      return;
    }
    videoPlayer.seek(time);
    videoPlayer.play();
  });

  playbackSync.addEventListener('remotePause', (e) => {
    const { time, playlistContinuous } = e.detail;
    if (playlistContinuous) {
      if (!canHandleRemoteContinuousSync()) {
        warnRemoteContinuousSyncUnavailable('pause', time);
        return;
      }
      if (continuousPlaybackState.active) {
        stopContinuousPlayback();
        invalidateActiveVideoLoad();
      }
      videoPlayer.pause();
      void seekContinuousTimeline(time, { resumePlayback: false });
      return;
    }
    videoPlayer.pause();
    videoPlayer.seek(time);
  });

  playbackSync.addEventListener('remoteSeek', (e) => {
    const { time, playlistContinuous } = e.detail;
    if (playlistContinuous) {
      if (!canHandleRemoteContinuousSync()) {
        warnRemoteContinuousSyncUnavailable('seek', time);
        return;
      }
      void seekContinuousTimeline(time);
      return;
    }
    videoPlayer.seek(time);
  });

  // 리모트에서 리더 모드 변경 수신 → UI 반영
  playbackSync.addEventListener('leaderModeChanged', (e) => {
    const { mode } = e.detail;
    syncModeRadios.forEach(radio => {
      radio.checked = radio.value === mode;
    });
  });

  // ====== 파일 변경 감지 (실시간 동기화) ======
  // 다른 사용자가 저장하면 즉시 동기화
  let lastSyncTime = 0;
  const MIN_SYNC_INTERVAL = 500; // 최소 500ms 간격

  async function syncReviewFileFromDisk(filePath, options = {}) {
    const {
      startCollaborationIfNeeded = false,
      bypassDebounce = false,
      replaceDeferredDiscovery = false,
      source = 'watch'
    } = options;

    // 현재 열린 파일이 아니면 무시
    if (!isSameFilePath(filePath, reviewDataManager.currentBframePath)) return false;

    // Liveblocks 연결 중이면 Broadcast가 실시간 동기화를 담당하므로
    // 파일 기반 동기화 건너뛰기 (구버전 파일로 덮어쓰는 것 방지)
    if (liveblocksManager.isConnected) {
      return false;
    }

    // 오프라인 모드: 파일 기반 동기화 실행
    // 너무 빠른 연속 호출 방지
    const now = Date.now();
    if (!bypassDebounce && source !== 'poll' && now - lastSyncTime < MIN_SYNC_INTERVAL) return false;
    lastSyncTime = now;

    log.info('파일 변경 감지됨, 오프라인 모드 동기화', { filePath, source });

    try {
      // ReviewDataManager의 reloadAndMerge 사용 (오프라인 모드 전용)
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

      if (result.success && startCollaborationIfNeeded && replaceDeferredDiscovery) {
        await stopDeferredReviewFileDiscovery(filePath);
      }

      if (result.success && startCollaborationIfNeeded && !liveblocksManager.isConnected) {
        await startCollaborationForVideoLoad(latestVideoLoadToken, filePath);
      }

      return result.success === true;
    } catch (error) {
      log.warn('파일 변경 동기화 실패', { error: error.message });
      return false;
    }
  }

  window.electronAPI.onFileChanged(async ({ filePath }) => {
    if (isDeferredReviewFileDiscoveryActive(filePath)) {
      await handleDeferredReviewFileDiscovered(filePath, 'watch');
      return;
    }

    await syncReviewFileFromDisk(filePath);
  });

  // ====== 재생목록 초기화 ======
  initPlaylistFeature();
  initCutlistFeature();

  // renderer 초기화 완료 → main process에 알림 (파일 인자 전송 트리거)
  // 시작 파일이 .bplaylist/.bcutlist일 수 있으므로 전용 리스너 등록 후 알린다.
  window.electronAPI.notifyRendererReady?.();
  log.info('renderer 초기화 완료, renderer-ready 전송');

  log.info('앱 초기화 완료');

  // 버전 표시
  try {
    const version = await window.electronAPI.getVersion();
    log.info('앱 버전', { version });
  } catch (e) {
    log.warn('버전 정보를 가져올 수 없습니다.');
  }

  // ============================================================================
  // 재생목록 사전 변환
  // ============================================================================

  async function preTranscodePlaylistItems() {
    const playlistManager = getPlaylistManager();
    if (!playlistManager.isActive()) return;

    const backgroundToken = playlistBackgroundWorkToken;
    const isCurrentBackgroundWork = () => (
      backgroundToken === playlistBackgroundWorkToken &&
      playlistManager.isActive()
    );

    const items = playlistManager.getItems();
    const currentIndex = playlistManager.currentIndex;
    let ffmpegAvailable = null;

    // 현재 아이템 다음부터 순서대로 확인 (우선순위: 바로 다음 아이템)
    for (let offset = 1; offset < items.length; offset++) {
      const targetIndex = (currentIndex + offset) % items.length;
      const item = items[targetIndex];

      try {
        const useMpvPilot = await shouldUseMpvPilot(item.videoPath, {
          fileIsAudio: isAudioFile(item.fileName || item.videoPath),
          hasPreparedVideoPath: false
        });
        if (!isCurrentBackgroundWork()) return;
        if (useMpvPilot) {
          log.debug('mpv 파일럿 사전 변환 건너뜀', { fileName: item.fileName, index: targetIndex });
          continue;
        }

        if (ffmpegAvailable === null) {
          ffmpegAvailable = await window.electronAPI.ffmpegIsAvailable();
          if (!isCurrentBackgroundWork()) return;
        }
        if (!ffmpegAvailable) return;

        // 코덱 확인
        const codecInfo = await window.electronAPI.ffmpegProbeCodec(item.videoPath);
        if (!isCurrentBackgroundWork()) return;
        if (!codecInfo.success || codecInfo.isSupported) continue;

        // 캐시 확인
        const cacheResult = await window.electronAPI.ffmpegCheckCache(item.videoPath);
        if (!isCurrentBackgroundWork()) return;
        if (cacheResult.valid) continue;

        // 변환 필요 - 백그라운드 시작
        log.info('사전 변환 시작', { fileName: item.fileName, index: targetIndex });
        window.electronAPI.ffmpegPreTranscode(item.videoPath)
          .then(result => {
            if (!isCurrentBackgroundWork()) return;
            if (result.success) {
              log.info('사전 변환 완료', { fileName: item.fileName });
            }
          })
          .catch(err => {
            log.warn('사전 변환 실패', { fileName: item.fileName, error: err.message });
          });

        // 한 번에 하나만 사전 변환 (시스템 부하 방지)
        break;
      } catch (err) {
        log.warn('사전 변환 코덱 확인 실패', { fileName: item.fileName, error: err.message });
      }
    }
  }

  function toLocalMediaUrl(filePath) {
    return String(filePath || '').startsWith('file://') ? filePath : `file://${filePath}`;
  }

  function ensurePlaylistPreloadElement() {
    if (playlistMediaPreload.element) return playlistMediaPreload.element;

    const media = document.createElement('video');
    media.preload = 'auto';
    media.muted = true;
    media.playsInline = true;
    media.style.display = 'none';
    media.setAttribute('aria-hidden', 'true');
    document.body.appendChild(media);
    playlistMediaPreload.element = media;
    return media;
  }

  function clearPlaylistMediaPreload() {
    playlistMediaPreload.token += 1;
    playlistMediaPreload.itemId = null;
    playlistMediaPreload.path = null;
    playlistMediaPreload.ready = false;

    const media = playlistMediaPreload.element;
    if (media) {
      media.onloadedmetadata = null;
      media.onloadeddata = null;
      media.oncanplay = null;
      media.onseeked = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load?.();
    }
  }

  function ensureCutlistPreloadElement() {
    if (cutlistMediaPreload.element) return cutlistMediaPreload.element;

    const media = document.createElement('video');
    media.preload = 'auto';
    media.muted = true;
    media.playsInline = true;
    media.style.display = 'none';
    media.setAttribute('aria-hidden', 'true');
    document.body.appendChild(media);
    cutlistMediaPreload.element = media;
    return media;
  }

  function clearCutlistMediaPreload() {
    cutlistMediaPreload.token += 1;
    cutlistMediaPreload.cutId = null;
    cutlistMediaPreload.sourceId = null;
    cutlistMediaPreload.path = null;
    cutlistMediaPreload.frame = null;
    cutlistMediaPreload.ready = false;

    const media = cutlistMediaPreload.element;
    if (media) {
      media.onloadedmetadata = null;
      media.onloadeddata = null;
      media.oncanplay = null;
      media.onseeked = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load?.();
    }
  }

  function preloadNextCutlistMedia(cut) {
    const cutlistManager = getCutlistManager();
    if (!cutlistUIState.active || !cutlistManager.isActive() || !cut?.id) {
      clearCutlistMediaPreload();
      return;
    }

    const nextCut = getNextCutlistCut(cut);
    if (!nextCut) {
      clearCutlistMediaPreload();
      return;
    }

    const source = cutlistManager.getSourceById(nextCut.sourceId);
    if (!source?.videoPath || source.missing === true || isSameFilePath(state.currentFile, source.videoPath)) {
      clearCutlistMediaPreload();
      return;
    }

    const frame = Math.max(0, Number(nextCut.startFrame) || 0);
    if (
      cutlistMediaPreload.cutId === nextCut.id &&
      cutlistMediaPreload.path === source.videoPath &&
      cutlistMediaPreload.frame === frame
    ) {
      return;
    }

    const token = ++cutlistMediaPreload.token;
    cutlistMediaPreload.cutId = nextCut.id;
    cutlistMediaPreload.sourceId = source.id;
    cutlistMediaPreload.path = source.videoPath;
    cutlistMediaPreload.frame = frame;
    cutlistMediaPreload.ready = false;

    const media = ensureCutlistPreloadElement();
    const fps = Number(nextCut.fps) > 0 ? Number(nextCut.fps) : 24;
    const targetTime = Math.max(0, (frame / fps) + 0.001);

    const markReady = () => {
      if (token !== cutlistMediaPreload.token) return;
      cutlistMediaPreload.ready = media.readyState >= 2;
      log.debug('컷 묶음 다음 소스 사전 로드됨', {
        label: nextCut.label,
        fileName: source.fileName,
        frame,
        readyState: media.readyState
      });
    };

    const markFailed = () => {
      if (token !== cutlistMediaPreload.token) return;
      cutlistMediaPreload.ready = false;
      log.warn('컷 묶음 다음 소스 사전 로드 실패', {
        label: nextCut.label,
        fileName: source.fileName
      });
    };

    const seekToTarget = () => {
      if (token !== cutlistMediaPreload.token) return;
      try {
        media.currentTime = targetTime;
      } catch (error) {
        log.debug('컷 묶음 사전 로드 프레임 이동 실패', {
          label: nextCut.label,
          frame,
          error: error.message
        });
        markReady();
      }
    };

    media.onloadedmetadata = seekToTarget;
    media.onloadeddata = markReady;
    media.oncanplay = markReady;
    media.onseeked = markReady;
    media.onerror = markFailed;
    media.src = toLocalMediaUrl(source.videoPath);
    media.load();
  }

  async function preloadPlaylistMediaForItem(item, options = {}) {
    const { continuous = false, sessionId = null } = options;
    if (!item?.videoPath) return;
    if (continuous && !isContinuousSessionActive(sessionId)) return;
    if (isSameFilePath(state.currentFile, item.videoPath)) return;
    const useMpvPilot = await shouldUseMpvPilot(item.videoPath, {
      fileIsAudio: isAudioFile(item.fileName || item.videoPath),
      hasPreparedVideoPath: false
    });
    if (continuous && !isContinuousSessionActive(sessionId)) return;
    if (isSameFilePath(state.currentFile, item.videoPath)) return;
    if (useMpvPilot) {
      log.debug('mpv 파일럿 재생목록 HTML 사전 로드 건너뜀', {
        fileName: item.fileName,
        continuous
      });
      return;
    }
    if (
      playlistMediaPreload.itemId === item.id &&
      playlistMediaPreload.path === item.videoPath
    ) {
      return;
    }

    const token = ++playlistMediaPreload.token;
    playlistMediaPreload.itemId = item.id;
    playlistMediaPreload.path = item.videoPath;
    playlistMediaPreload.ready = false;

    const media = ensurePlaylistPreloadElement();
    const isCurrentPreload = () => (
      token === playlistMediaPreload.token &&
      (!continuous || isContinuousSessionActive(sessionId))
    );
    const markReady = () => {
      if (!isCurrentPreload()) return;
      playlistMediaPreload.ready = media.readyState >= 2;
      log.debug('재생목록 다음 미디어 사전 로드됨', {
        fileName: item.fileName,
        continuous,
        readyState: media.readyState
      });
    };
    const markFailed = () => {
      if (!isCurrentPreload()) return;
      playlistMediaPreload.ready = false;
      log.warn('재생목록 다음 미디어 사전 로드 실패', { fileName: item.fileName, continuous });
    };

    media.onloadedmetadata = markReady;
    media.onloadeddata = markReady;
    media.oncanplay = markReady;
    media.onseeked = markReady;
    media.onerror = markFailed;
    media.src = toLocalMediaUrl(item.videoPath);
    media.load();
  }

  function preloadNextPlaylistMedia() {
    const playlistManager = getPlaylistManager();
    if (!playlistManager.isActive() || !userSettings.getPlaylistAutoPlay() || continuousPlaybackState.active) {
      clearPlaylistMediaPreload();
      return;
    }

    const items = playlistManager.getItems();
    const nextIndex = playlistManager.currentIndex + 1;
    const nextItem = items[nextIndex];
    if (!nextItem?.videoPath) {
      clearPlaylistMediaPreload();
      return;
    }

    void preloadPlaylistMediaForItem(nextItem);
  }

  function warmPlaylistAutoPlayQueue() {
    const playlistManager = getPlaylistManager();
    if (!playlistManager.isActive() || !userSettings.getPlaylistAutoPlay()) return;
    preloadNextPlaylistMedia();
  }

  function shouldStartPlaylistContinuousAutoPlayback() {
    const playlistManager = getPlaylistManager();
    return (
      playlistUIState.mode === 'continuous' &&
      !continuousPlaybackState.active &&
      playlistManager.isActive() &&
      userSettings.getPlaylistAutoPlay() &&
      !playlistManager.isEmpty()
    );
  }

  function getPlaybackSyncPosition(localTime = videoPlayer.currentTime, options = {}) {
    const { forceContinuous = false } = options;
    if (
      (forceContinuous || continuousPlaybackState.active === true) &&
      playlistUIState.mode === 'continuous' &&
      timeline.playlistDuration > 0
    ) {
      const segment = getCurrentContinuousSegment();
      if (!segment) return { time: localTime, options: {} };
      return {
        time: mapLocalTimeToGlobal(segment, localTime),
        options: { playlistContinuous: true }
      };
    }
    return { time: localTime, options: {} };
  }

  function getPlaylistContinuousSyncPositionForItem(item, localTime = videoPlayer.currentTime) {
    if (playlistUIState.mode !== 'continuous' || !timeline.playlistDuration || !item?.id) return null;
    const segment = timeline.playlistSegments?.find(candidate => candidate.itemId === item.id);
    if (!segment) return null;
    return {
      time: mapLocalTimeToGlobal(segment, localTime),
      options: { playlistContinuous: true }
    };
  }

  function broadcastCurrentPlaybackPause(options = {}) {
    const position = getPlaybackSyncPosition(videoPlayer.currentTime, options);
    playbackSync.broadcastPause(position.time, position.options);
  }

  function broadcastCurrentPlaybackPlay() {
    const position = getPlaybackSyncPosition(videoPlayer.currentTime);
    playbackSync.broadcastPlay(position.time, position.options);
  }

  function broadcastPlaylistContinuousPlaybackPlay(item, localTime = videoPlayer.currentTime) {
    const position = getPlaylistContinuousSyncPositionForItem(item, localTime);
    if (!position) {
      log.warn('타임라인 이어붙이기 재생 위치를 공유할 수 없습니다', {
        itemId: item?.id || null,
        filePath: item?.videoPath || null,
        playlistDuration: timeline.playlistDuration,
        localTime
      });
      return;
    }
    playbackSync.broadcastPlay(position.time, position.options);
  }

  async function handleUserPlayPauseToggle() {
    const wasPlaying = videoPlayer.isPlaying;
    if (wasPlaying) {
      const continuousPausePosition = continuousPlaybackState.active
        ? getPlaybackSyncPosition(videoPlayer.currentTime, { forceContinuous: true })
        : null;
      if (continuousPlaybackState.active) {
        stopContinuousPlayback();
        invalidateActiveVideoLoad();
      }
      videoPlayer.togglePlay();
      if (continuousPausePosition) {
        playbackSync.broadcastPause(continuousPausePosition.time, continuousPausePosition.options);
      } else {
        broadcastCurrentPlaybackPause();
      }
      return;
    }

    if (continuousPlaybackState.active) {
      const continuousPausePosition = getPlaybackSyncPosition(videoPlayer.currentTime, { forceContinuous: true });
      stopContinuousPlayback();
      invalidateActiveVideoLoad();
      videoPlayer.pause();
      playbackSync.broadcastPause(continuousPausePosition.time, continuousPausePosition.options);
      return;
    }

    if (shouldStartPlaylistContinuousAutoPlayback()) {
      const startedItem = await startContinuousPlayback();
      if (startedItem) {
        broadcastPlaylistContinuousPlaybackPlay(startedItem, videoPlayer.currentTime);
      }
      return;
    }

    warmPlaylistAutoPlayQueue();
    videoPlayer.togglePlay();
    broadcastCurrentPlaybackPlay();
  }

  // ============================================================================
  // 재생목록 기능
  // ============================================================================

  function getCurrentContinuousSegment() {
    if (playlistUIState.mode !== 'continuous' || !timeline.playlistDuration) return null;
    const playlistManager = getPlaylistManager();
    const items = playlistManager.getItems?.() || [];
    const currentItem = playlistManager.getCurrentItem?.();
    const itemId = isSameFilePath(currentItem?.videoPath, state.currentFile)
      ? currentItem.id
      : items.find(item => isSameFilePath(item.videoPath, state.currentFile))?.id;
    if (!itemId) return null;
    return timeline.playlistSegments?.find(segment => segment.itemId === itemId) || null;
  }

  function shouldIgnoreContinuousTimelineUpdateDuringSourceLoad() {
    if (playlistUIState.mode !== 'continuous' || !continuousPlaybackState.loadingItemId) return false;

    const playlistManager = getPlaylistManager();
    const loadingItem = playlistManager.getItems?.()
      ?.find(item => item.id === continuousPlaybackState.loadingItemId);
    if (!loadingItem?.videoPath) return false;

    return !isSameFilePath(state.currentFile, loadingItem.videoPath);
  }

  function getContinuousTimelinePlaybackTime(localTime = videoPlayer.currentTime) {
    const segment = getCurrentContinuousSegment();
    if (!segment) return localTime;
    return mapLocalTimeToGlobal(segment, localTime);
  }

  async function seekContinuousTimeline(globalTime, options = {}) {
    const { resumePlayback = true } = options;
    const playlistManager = getPlaylistManager();
    const mapped = mapGlobalTimeToSegment(timeline.playlistSegments, globalTime);
    if (!mapped) return false;

    const item = playlistManager.getItems()[mapped.segment.index];
    if (!item) return false;
    const wasContinuousActive = continuousPlaybackState.active === true;
    const shouldResumePlayback = resumePlayback && (videoPlayer.isPlaying === true || wasContinuousActive);
    const manualSessionId = wasContinuousActive
      ? restartContinuousPlaybackSessionForManualSeek()
      : null;
    const navigationToken = ++playlistContinuousNavigationToken;
    const isCurrentNavigation = () => (
      navigationToken === playlistContinuousNavigationToken &&
      playlistUIState.mode === 'continuous' &&
      timeline.playlistDuration > 0 &&
      (manualSessionId === null || isContinuousSessionActive(manualSessionId))
    );

    if (playlistManager.getCurrentItem?.()?.id !== item.id) {
      suppressPlaylistSelectionLoad = true;
      try {
        playlistManager.selectItemById(item.id);
      } finally {
        suppressPlaylistSelectionLoad = false;
      }
      if (!isCurrentNavigation()) return false;
    }

    const isAlreadyLoaded = isSameFilePath(state.currentFile, item.videoPath) &&
      !hasActiveVideoLoadForDifferentFile(item.videoPath);
    const targetFrame = Math.max(0, Math.floor(mapped.localTime * (mapped.segment.fps || item.fps || videoPlayer.fps || 24)));
    const previousLoadingItemId = continuousPlaybackState.loadingItemId;
    const previousLoadingSessionId = continuousPlaybackState.loadingSessionId;
    let setManualLoadingItem = false;
    try {
      if (!isAlreadyLoaded) {
        continuousPlaybackState.loadingItemId = item.id;
        continuousPlaybackState.loadingSessionId = manualSessionId;
        setManualLoadingItem = true;
        const loaded = await loadVideoFromPlaylist(item, {
          preserveContinuousSession: true,
          initialFrame: targetFrame,
          revealAfterInitialSeek: true,
          holdPreviousFrameUntilReady: true,
          shouldContinue: isCurrentNavigation
        });
        if (!loaded) return false;
        if (!isCurrentNavigation()) return false;
      }

      if (!isCurrentNavigation()) return false;
      videoPlayer.seek(mapped.localTime);
      playbackSync.broadcastSeek(mapLocalTimeToGlobal(mapped.segment, mapped.localTime), {
        playlistContinuous: true
      });
      timeline.setCurrentTime(mapLocalTimeToGlobal(mapped.segment, mapped.localTime));
      updatePlaylistCurrentItem();
      updatePlaylistPosition();
    } finally {
      if (
        setManualLoadingItem &&
        continuousPlaybackState.loadingItemId === item.id &&
        continuousPlaybackState.loadingSessionId === manualSessionId
      ) {
        continuousPlaybackState.loadingItemId = previousLoadingItemId;
        continuousPlaybackState.loadingSessionId = previousLoadingSessionId;
      }
    }
    if (manualSessionId !== null) {
      prepareNextPlaylistItem(manualSessionId);
    }
    if (shouldResumePlayback) {
      await playVideoAfterMediaLoad({
        silent: true,
        logContext: { fileName: item.fileName, continuousSeek: true }
      });
    }
    return true;
  }

  function resetContinuousPlaybackRuntimeState(active) {
    continuousPlaybackState.active = active;
    continuousPlaybackState.waiting = false;
    continuousPlaybackState.skippedBatch = [];
    continuousPlaybackState.loadingItemId = null;
    continuousPlaybackState.loadingSessionId = null;
    continuousPlaybackState.preparePromises.clear();
    continuousPlaybackState.preparedMediaPaths.clear();
    clearPlaylistMediaPreload();
  }

  function restartContinuousPlaybackSessionForManualSeek() {
    continuousPlaybackState.sessionId += 1;
    resetContinuousPlaybackRuntimeState(true);
    return continuousPlaybackState.sessionId;
  }

  function stopContinuousPlayback() {
    continuousPlaybackState.sessionId += 1;
    resetContinuousPlaybackRuntimeState(false);
  }

  function isContinuousSessionActive(sessionId) {
    return continuousPlaybackState.active && continuousPlaybackState.sessionId === sessionId;
  }

  function updatePlaylistPrepareSummary() {
    const playlistManager = getPlaylistManager();
    const items = playlistManager.getItems?.() || [];
    const readyCount = items.filter(item => item.continuousStatus === CONTINUOUS_STATUS.READY).length;
    const mpvReadyCount = items.filter(item =>
      item.continuousStatus === CONTINUOUS_STATUS.READY &&
      String(item.continuousMessage || '').toLowerCase().includes('mpv')
    ).length;
    if (elements.playlistPrepareSummaryText) {
      const baseText = `${readyCount}/${items.length}개 바로 재생 가능`;
      elements.playlistPrepareSummaryText.textContent = mpvReadyCount > 0
        ? `${baseText} (mpv 원본 ${mpvReadyCount}개)`
        : baseText;
    }
  }

  function setPlaylistContinuousTimelineBusy(busy) {
    if (!elements.playlistPrepareSummaryText) return;
    if (busy) {
      elements.playlistPrepareSummaryText.textContent = '타임라인 준비 중...';
      elements.playlistPrepareSummary?.classList.add('is-preparing');
      return;
    }

    elements.playlistPrepareSummary?.classList.remove('is-preparing');
    updatePlaylistPrepareSummary();
  }

  function markPlaylistItemStatus(item, status, message = '') {
    if (!item) return;
    item.continuousStatus = status;
    item.continuousMessage = message;
    updatePlaylistPrepareSummary();
    const el = document.querySelector(`.playlist-item[data-id="${item.id}"]`);
    if (el) {
      el.dataset.continuousStatus = status;
      el.classList.toggle('missing', status === CONTINUOUS_STATUS.MISSING);
      const statusEl = el.querySelector('.playlist-item-continuous-status');
      if (statusEl) statusEl.textContent = message || status;
    }
  }

  function flushSkippedToastBatch() {
    if (continuousPlaybackState.skippedBatch.length === 0) return;
    showToast(createSkippedToastMessage(continuousPlaybackState.skippedBatch), 'warning');
    continuousPlaybackState.skippedBatch = [];
  }

  async function canReusePreparedContinuousItem(item) {
    if (!item || item.continuousStatus !== CONTINUOUS_STATUS.READY) return false;
    if (continuousPlaybackState.preparedMediaPaths.has(item.id)) return true;

    const useMpvPilot = await shouldUseMpvPilot(item.videoPath, {
      fileIsAudio: isAudioFile(item.fileName || item.videoPath),
      hasPreparedVideoPath: false
    });
    return useMpvPilot === true;
  }

  async function collectPlaylistMetadata(items) {
    const metadata = new Map();
    for (const item of items) {
      if (isSameFilePath(state.currentFile, item.videoPath) && videoPlayer.duration) {
        metadata.set(item.id, { duration: videoPlayer.duration, fps: videoPlayer.fps || 24 });
        continue;
      }

      let duration = Number(item.duration);
      let fps = Number(item.fps);
      const hasDuration = Number.isFinite(duration) && duration > 0;

      const useMpvPilotForMetadata = !hasDuration && item.videoPath
        ? await shouldUseMpvPilot(item.videoPath, {
          fileIsAudio: isAudioFile(item.fileName || item.videoPath),
          hasPreparedVideoPath: false
        })
        : false;

      if (!hasDuration && item.videoPath && useMpvPilotForMetadata) {
        try {
          const mpvProbe = await window.electronAPI.mpvProbeMetadata(item.videoPath);
          if (mpvProbe?.success) {
            const probeDuration = Number(mpvProbe.duration);
            const probeFps = Number(mpvProbe.fps);
            if (Number.isFinite(probeDuration) && probeDuration > 0) {
              duration = probeDuration;
              fps = Number.isFinite(probeFps) && probeFps > 0
                ? probeFps
                : (Number.isFinite(fps) && fps > 0 ? fps : 24);
              item.duration = duration;
              item.fps = fps;
            }
          } else {
            log.warn('mpv 타임라인 메타데이터 수집 실패: FFmpeg 없이 건너뜀', { fileName: item.fileName, error: mpvProbe?.error || 'probe failed' });
          }
        } catch (error) {
          log.warn('mpv 타임라인 메타데이터 수집 실패: FFmpeg 없이 건너뜀', { fileName: item.fileName, error: error.message });
        }
      }

      if (!hasDuration && item.videoPath && !useMpvPilotForMetadata) {
        try {
          const probe = await window.electronAPI.ffmpegProbeCodec(item.videoPath);
          if (probe?.success) {
            const probeDuration = Number(probe.duration);
            const probeFps = Number(probe.frameRate);
            if (Number.isFinite(probeDuration) && probeDuration > 0) {
              duration = probeDuration;
              fps = Number.isFinite(probeFps) && probeFps > 0
                ? probeFps
                : (Number.isFinite(fps) && fps > 0 ? fps : 24);
              item.duration = duration;
              item.fps = fps;
            }
          } else {
            log.warn('타임라인 이어붙이기 영상 메타데이터 수집 실패', { fileName: item.fileName, error: probe?.error || 'probe failed' });
          }
        } catch (error) {
          log.warn('타임라인 이어붙이기 영상 메타데이터 수집 실패', { fileName: item.fileName, error: error.message });
        }
      }

      metadata.set(item.id, {
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        fps: Number.isFinite(fps) && fps > 0 ? fps : 24
      });
    }
    return metadata;
  }

  async function updatePlaylistContinuousTimeline() {
    if (playlistUIState.mode !== 'continuous') return;
    timeline.clearCommentMarkers();
    timeline.renderPlaylistCommentRanges([], 0);
    const updateToken = ++playlistTimelineUpdateToken;
    const playlistManager = getPlaylistManager();
    const items = playlistManager.getItems();

    setPlaylistContinuousTimelineBusy(true);
    try {
      const metadata = await collectPlaylistMetadata(items);
      if (playlistUIState.mode !== 'continuous' || playlistTimelineUpdateToken !== updateToken) return;

      const { segments, totalDuration } = buildPlaylistSegments(items, metadata);
      timeline.setPlaylistTimeline(segments, totalDuration);
      timeline.setCurrentTime(getContinuousTimelinePlaybackTime());

      const aggregateRanges = [];

      for (const segment of segments) {
        const item = items[segment.index];
        const bframePath = await playlistManager.ensureItemBframePath(item);
        if (!bframePath) continue;
        try {
          const bframeData = await window.electronAPI.loadReview(bframePath);
          if (playlistUIState.mode !== 'continuous' || playlistTimelineUpdateToken !== updateToken) return;
          if (!bframeData) continue;
          aggregateRanges.push(...extractPlaylistCommentRanges({
            bframeData,
            segment,
            visibleLayerIds: null,
            allowedAuthorIds: null
          }));
        } catch (error) {
          log.warn('타임라인 이어붙이기 댓글 로드 실패', { fileName: item.fileName, error: error.message });
        }
      }

      if (playlistUIState.mode !== 'continuous' || playlistTimelineUpdateToken !== updateToken) return;
      playlistAggregateCommentRanges = aggregateRanges;
      const filteredRanges = filterPlaylistAggregateCommentRanges(
        aggregateRanges,
        commentFilterState.status
      );
      timeline.renderPlaylistCommentRanges(filteredRanges, totalDuration);
      renderPlaylistContinuousCommentList(commentFilterState.status);
    } finally {
      if (playlistUIState.mode === 'continuous' && playlistTimelineUpdateToken === updateToken) {
        setPlaylistContinuousTimelineBusy(false);
      }
    }
  }

  async function quickCheckPlaylistForContinuous(sessionId, itemsToCheck = null) {
    const playlistManager = getPlaylistManager();
    const items = Array.isArray(itemsToCheck) ? itemsToCheck : playlistManager.getItems();

    for (const item of items) {
      if (!isContinuousSessionActive(sessionId)) return false;
      if (![CONTINUOUS_STATUS.PREPARING, CONTINUOUS_STATUS.READY].includes(item.continuousStatus)) {
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.CHECKING, '확인 중');
      }
      try {
        const exists = await window.electronAPI.fileExists(item.videoPath);
        if (!isContinuousSessionActive(sessionId)) return false;
        if (!exists) {
          markPlaylistItemStatus(item, CONTINUOUS_STATUS.MISSING, '문제 있음');
          continue;
        }
        if (item.continuousStatus === CONTINUOUS_STATUS.CHECKING) {
          markPlaylistItemStatus(item, CONTINUOUS_STATUS.IDLE, '');
        }
      } catch (error) {
        if (!isContinuousSessionActive(sessionId)) return false;
        log.warn('타임라인 이어붙이기 파일 확인 실패', { fileName: item.fileName, error: error.message });
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.ERROR, '건너뜀');
        continue;
      }
    }

    if (!isContinuousSessionActive(sessionId)) return false;
    updatePlaylistPrepareSummary();
    return isContinuousSessionActive(sessionId);
  }

  async function preparePlaylistItemInBackground(item, sessionId = continuousPlaybackState.sessionId) {
    if (!item) return undefined;

    const existingPrepare = continuousPlaybackState.preparePromises.get(item.id);
    if (existingPrepare?.sessionId === sessionId) {
      return existingPrepare.promise;
    }

    if (item.continuousStatus === CONTINUOUS_STATUS.READY && await canReusePreparedContinuousItem(item)) {
      return { ready: true, cached: true };
    }
    if (item.continuousStatus === CONTINUOUS_STATUS.READY) {
      markPlaylistItemStatus(item, CONTINUOUS_STATUS.IDLE, '');
    }

    if ([
      CONTINUOUS_STATUS.MISSING,
      CONTINUOUS_STATUS.SKIPPED,
      CONTINUOUS_STATUS.ERROR
    ].includes(item.continuousStatus)) {
      return { ready: false, error: item.continuousMessage || item.continuousStatus };
    }

    const promise = (async () => {
      const shouldContinuePreparing = () => (
        isContinuousSessionActive(sessionId) &&
        item.continuousStatus !== CONTINUOUS_STATUS.SKIPPED
      );

      try {
        if (!shouldContinuePreparing()) return { ready: false, stale: true };
        continuousPlaybackState.preparedMediaPaths.delete(item.id);
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.PREPARING, '준비 중');
        const useMpvPilot = await shouldUseMpvPilot(item.videoPath, {
          fileIsAudio: isAudioFile(item.fileName || item.videoPath),
          hasPreparedVideoPath: false
        });
        if (!shouldContinuePreparing()) return { ready: false, stale: true };
        if (useMpvPilot) {
          await cancelPlaylistBackgroundTranscodesForMpvPilot('mpv 재생목록 원본 준비');
          if (!shouldContinuePreparing()) return { ready: false, stale: true };
          continuousPlaybackState.preparedMediaPaths.delete(item.id);
          markPlaylistItemStatus(item, CONTINUOUS_STATUS.READY, 'mpv 원본 준비');
          return { ready: true, mpv: true };
        }

        const ffmpegAvailable = await window.electronAPI.ffmpegIsAvailable();
        if (!shouldContinuePreparing()) return { ready: false, stale: true };
        if (!ffmpegAvailable) {
          continuousPlaybackState.preparedMediaPaths.set(item.id, item.videoPath);
          markPlaylistItemStatus(item, CONTINUOUS_STATUS.READY, '준비 완료');
          return { ready: true };
        }

        const codecInfo = await window.electronAPI.ffmpegProbeCodec(item.videoPath);
        if (!shouldContinuePreparing()) return { ready: false, stale: true };
        if (!codecInfo.success || codecInfo.isSupported) {
          continuousPlaybackState.preparedMediaPaths.set(item.id, item.videoPath);
          markPlaylistItemStatus(item, CONTINUOUS_STATUS.READY, '준비 완료');
          return { ready: true };
        }

        const cacheResult = await window.electronAPI.ffmpegCheckCache(item.videoPath);
        if (!shouldContinuePreparing()) return { ready: false, stale: true };
        if (cacheResult.valid) {
          continuousPlaybackState.preparedMediaPaths.set(item.id, cacheResult.convertedPath);
          markPlaylistItemStatus(item, CONTINUOUS_STATUS.READY, '준비 완료');
          return { ready: true, cached: true };
        }

        const result = await window.electronAPI.ffmpegPreTranscode(item.videoPath);
        if (!shouldContinuePreparing()) return { ready: false, stale: true };
        if (result.success) {
          continuousPlaybackState.preparedMediaPaths.set(item.id, result.outputPath);
          markPlaylistItemStatus(item, CONTINUOUS_STATUS.READY, '준비 완료');
          return { ready: true };
        }

        markPlaylistItemStatus(item, CONTINUOUS_STATUS.ERROR, '건너뜀');
        return { ready: false, error: result.error || '변환 실패' };
      } catch (error) {
        if (!shouldContinuePreparing()) return { ready: false, stale: true };
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.ERROR, '건너뜀');
        return { ready: false, error: error.message };
      } finally {
        const currentPrepare = continuousPlaybackState.preparePromises.get(item.id);
        if (currentPrepare?.promise === promise) {
          continuousPlaybackState.preparePromises.delete(item.id);
        }
      }
    })();

    continuousPlaybackState.preparePromises.set(item.id, { sessionId, promise });
    return promise;
  }

  function prepareNextPlaylistItem(sessionId) {
    if (!isContinuousSessionActive(sessionId)) return;
    const playlistManager = getPlaylistManager();
    const items = playlistManager.getItems();
    const settings = playlistManager.getContinuousSettings();
    const nextIndex = findNextPlayableIndex(items, playlistManager.currentIndex, { loop: settings.loop });
    if (nextIndex >= 0) {
      void preloadPlaylistMediaForItem(items[nextIndex], { continuous: true, sessionId });
      preparePlaylistItemInBackground(items[nextIndex], sessionId);
    }
  }

  async function waitForPreparedOrSkip(item, sessionId) {
    if (!isContinuousSessionActive(sessionId)) return false;
    if (!item) return false;
    if (item?.continuousStatus === CONTINUOUS_STATUS.READY && await canReusePreparedContinuousItem(item)) {
      return true;
    }
    if (item?.continuousStatus === CONTINUOUS_STATUS.READY) {
      markPlaylistItemStatus(item, CONTINUOUS_STATUS.IDLE, '');
    }
    if ([
      CONTINUOUS_STATUS.MISSING,
      CONTINUOUS_STATUS.SKIPPED,
      CONTINUOUS_STATUS.ERROR
    ].includes(item?.continuousStatus)) {
      if (!isContinuousSessionActive(sessionId)) return false;
      continuousPlaybackState.skippedBatch.push(item);
      return false;
    }

    continuousPlaybackState.waiting = true;
    const preparePromise = preparePlaylistItemInBackground(item, sessionId);
    const timeoutPromise = new Promise(resolve => {
      setTimeout(() => resolve({ ready: false, timedOut: true }), 5000);
    });
    const result = await Promise.race([preparePromise, timeoutPromise]);
    if (!isContinuousSessionActive(sessionId)) return false;
    continuousPlaybackState.waiting = false;
    if (result.ready) return true;

    markPlaylistItemStatus(item, CONTINUOUS_STATUS.SKIPPED, '건너뜀');
    continuousPlaybackState.skippedBatch.push(item);
    return false;
  }

  function selectPlaylistItemForContinuous(index) {
    suppressPlaylistSelectionLoad = true;
    try {
      return getPlaylistManager().selectItem(index);
    } finally {
      suppressPlaylistSelectionLoad = false;
    }
  }

  async function loadContinuousPlaylistItem(item, sessionId) {
    if (!isContinuousSessionActive(sessionId)) return false;

    continuousPlaybackState.loadingItemId = item.id;
    continuousPlaybackState.loadingSessionId = sessionId;
    try {
      prepareNextPlaylistItem(sessionId);
      const preparedVideoPath = continuousPlaybackState.preparedMediaPaths.get(item.id);
      const loaded = await loadVideoFromPlaylist(item, {
        preserveContinuousSession: true,
        holdPreviousFrameUntilReady: true,
        playWhenMediaReady: true,
        deferCollaborationStart: true,
        preparedVideoPath,
        shouldContinue: () => isContinuousSessionActive(sessionId)
      });
      if (!isContinuousSessionActive(sessionId)) return false;
      if (loaded === false) {
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.ERROR, '건너뜀');
        continuousPlaybackState.skippedBatch.push(item);
        return false;
      }
      return true;
    } finally {
      if (
        continuousPlaybackState.loadingItemId === item.id &&
        continuousPlaybackState.loadingSessionId === sessionId
      ) {
        continuousPlaybackState.loadingItemId = null;
        continuousPlaybackState.loadingSessionId = null;
      }
    }
  }

  function waitForContinuousDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getContinuousPlaybackSnapshot() {
    const media = videoPlayer.videoElement;
    if (videoPlayer.engine !== 'html5') {
      const currentTime = Math.max(0, Number(videoPlayer.currentTime) || 0);
      const duration = Math.max(0, Number(videoPlayer.duration) || 0);
      const externalEofReached = videoPlayer.externalEofReached === true;
      return {
        currentTime,
        duration,
        ended: externalEofReached || (duration > 0 && duration - currentTime <= 0.25 && !videoPlayer.isPlaying),
        externalEofReached,
        paused: !videoPlayer.isPlaying,
        ready: videoPlayer.isLoaded === true
      };
    }

    return {
      currentTime: Math.max(0, Number(media?.currentTime ?? videoPlayer.currentTime) || 0),
      duration: Math.max(0, Number(media?.duration ?? videoPlayer.duration) || 0),
      ended: media?.ended === true,
      paused: media?.paused === true,
      ready: Number(media?.readyState || 0) >= 2
    };
  }

  function hasContinuousPlaybackReachedMediaEnd(snapshot = getContinuousPlaybackSnapshot()) {
    const hasKnownDuration = snapshot.duration > 0;
    const nearMediaEnd = hasKnownDuration && snapshot.duration - snapshot.currentTime <= 0.25;
    if (snapshot.externalEofReached === true) return !hasKnownDuration || nearMediaEnd;
    return nearMediaEnd && snapshot.ended === true;
  }

  function waitForContinuousMediaReady(timeoutMs = 1200) {
    if (videoPlayer.engine !== 'html5') {
      return Promise.resolve(videoPlayer.isLoaded === true);
    }

    const media = videoPlayer.videoElement;
    if (!media) return Promise.resolve(false);
    if (media.readyState >= 2) return Promise.resolve(true);

    return new Promise(resolve => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        media.removeEventListener('canplay', onReady);
        media.removeEventListener('loadeddata', onReady);
        media.removeEventListener('error', onError);
        clearTimeout(timer);
        resolve(value);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(media.readyState >= 2), timeoutMs);

      media.addEventListener('canplay', onReady, { once: true });
      media.addEventListener('loadeddata', onReady, { once: true });
      media.addEventListener('error', onError, { once: true });
    });
  }

  function waitForContinuousPlaybackAdvance(sessionId, options = {}) {
    const timeoutMs = options.timeoutMs || 1100;
    const minDelta = options.minDelta || 0.03;
    const media = videoPlayer.videoElement;
    if (videoPlayer.engine === 'html5' && !media) return Promise.resolve(false);

    const snapshot = getContinuousPlaybackSnapshot();
    const startTime = snapshot.currentTime;
    if (hasContinuousPlaybackReachedMediaEnd(snapshot)) return Promise.resolve(true);

    return new Promise(resolve => {
      let settled = false;
      const startedAt = performance.now();

      const finish = (value) => {
        if (settled) return;
        settled = true;
        media?.removeEventListener('timeupdate', onProgress);
        media?.removeEventListener('ended', onEnded);
        videoPlayer.removeEventListener('timeupdate', onProgress);
        videoPlayer.removeEventListener('ended', onEnded);
        clearInterval(interval);
        resolve(value);
      };

      const hasAdvanced = () => {
        const currentSnapshot = getContinuousPlaybackSnapshot();
        return currentSnapshot.currentTime - startTime >= minDelta;
      };

      const onProgress = () => {
        if (hasAdvanced()) finish(true);
      };
      const onEnded = () => {
        if (hasContinuousPlaybackReachedMediaEnd()) finish(true);
      };
      const interval = setInterval(() => {
        if (!isContinuousSessionActive(sessionId)) {
          finish(false);
          return;
        }
        const currentSnapshot = getContinuousPlaybackSnapshot();
        if (hasAdvanced() || hasContinuousPlaybackReachedMediaEnd(currentSnapshot)) {
          finish(true);
          return;
        }
        if (performance.now() - startedAt >= timeoutMs) {
          finish(false);
        }
      }, 120);

      media?.addEventListener('timeupdate', onProgress);
      media?.addEventListener('ended', onEnded, { once: true });
      videoPlayer.addEventListener('timeupdate', onProgress);
      videoPlayer.addEventListener('ended', onEnded, { once: true });
    });
  }

  async function playContinuousItemWithWatchdog(item, sessionId) {
    if (!isContinuousSessionActive(sessionId)) return false;

    let started = videoPlayer.isPlaying === true;
    if (!started) {
      started = await videoPlayer.play();
    }
    if (!isContinuousSessionActive(sessionId)) return false;
    if (!started && !videoPlayer.isPlaying) {
      await waitForContinuousMediaReady(250);
      if (!isContinuousSessionActive(sessionId)) return false;
      const readyStarted = await videoPlayer.play();
      if (!isContinuousSessionActive(sessionId)) return false;
      if (!readyStarted && !videoPlayer.isPlaying) {
        markPlaylistItemStatus(item, CONTINUOUS_STATUS.ERROR, '건너뜀');
        continuousPlaybackState.skippedBatch.push(item);
        showToast('영상을 재생할 수 없어 다음 영상으로 넘어갑니다.', 'warning');
        return false;
      }
    }

    const advanced = await waitForContinuousPlaybackAdvance(sessionId, { timeoutMs: 800 });
    if (!isContinuousSessionActive(sessionId)) return false;
    if (advanced) return true;

    log.warn('연속 재생이 멈춘 상태라 다시 시도합니다', { fileName: item?.fileName });
    if (videoPlayer.isPlaying === true) {
      videoPlayer.pause();
      await waitForContinuousDelay(40);
    }
    await waitForContinuousMediaReady(250);
    if (!isContinuousSessionActive(sessionId)) return false;
    const retryStarted = await videoPlayer.play();
    if (!isContinuousSessionActive(sessionId)) return false;
    if (!retryStarted && !videoPlayer.isPlaying) {
      markPlaylistItemStatus(item, CONTINUOUS_STATUS.ERROR, '건너뜀');
      continuousPlaybackState.skippedBatch.push(item);
      showToast('영상을 재생할 수 없어 다음 영상으로 넘어갑니다.', 'warning');
      return false;
    }

    const retryAdvanced = await waitForContinuousPlaybackAdvance(sessionId, { timeoutMs: 1400 });
    if (retryAdvanced) return true;

    markPlaylistItemStatus(item, CONTINUOUS_STATUS.ERROR, '건너뜀');
    continuousPlaybackState.skippedBatch.push(item);
    showToast('영상을 재생할 수 없어 다음 영상으로 넘어갑니다.', 'warning');
    return false;
  }

  async function startContinuousPlayback() {
    const playlistManager = getPlaylistManager();
    if (!playlistManager.isActive() || playlistManager.isEmpty()) {
      showToast('재생목록에 영상을 먼저 추가해주세요.', 'warning');
      return null;
    }

    continuousPlaybackState.sessionId += 1;
    const sessionId = continuousPlaybackState.sessionId;
    continuousPlaybackState.active = true;
    continuousPlaybackState.waiting = false;
    continuousPlaybackState.skippedBatch = [];
    continuousPlaybackState.preparePromises.clear();

    try {
      const currentItem = playlistManager.getCurrentItem() || selectPlaylistItemForContinuous(0);
      if (!isContinuousSessionActive(sessionId)) return null;
      if (!currentItem) {
        stopContinuousPlayback();
        return null;
      }

      const checked = await quickCheckPlaylistForContinuous(sessionId, [currentItem]);
      if (!isContinuousSessionActive(sessionId) || !checked) return null;
      const remainingItems = playlistManager.getItems().filter(item => item.id !== currentItem.id);
      if (remainingItems.length > 0) {
        void quickCheckPlaylistForContinuous(sessionId, remainingItems);
      }

      const ready = await waitForPreparedOrSkip(currentItem, sessionId);
      if (!isContinuousSessionActive(sessionId)) return null;
      if (!ready) {
        return await playNextContinuousItem(sessionId);
      }

      const alreadyLoaded = isSameFilePath(state.currentFile, currentItem.videoPath);
      if (!alreadyLoaded) {
        const loaded = await loadContinuousPlaylistItem(currentItem, sessionId);
        if (!isContinuousSessionActive(sessionId)) return null;
        if (!loaded) {
          return await playNextContinuousItem(sessionId);
        }
        videoPlayer.seekToFrame(0);
      }
      if (!isContinuousSessionActive(sessionId)) return null;
      prepareNextPlaylistItem(sessionId);
      const started = await playContinuousItemWithWatchdog(currentItem, sessionId);
      if (!isContinuousSessionActive(sessionId)) return null;
      if (!started) {
        return await playNextContinuousItem(sessionId);
      }
      return currentItem;
    } catch (error) {
      if (!isContinuousSessionActive(sessionId)) return null;
      log.warn('타임라인 이어붙이기 시작 실패', { error: error.message });
      stopContinuousPlayback();
      showToast('타임라인 이어붙이기를 시작할 수 없습니다.', 'error');
      return null;
    }
  }

  async function playNextContinuousItem(sessionId) {
    if (!isContinuousSessionActive(sessionId)) return null;
    const playlistManager = getPlaylistManager();
    const items = playlistManager.getItems();
    const settings = playlistManager.getContinuousSettings();
    const nextIndex = findNextPlayableIndex(items, playlistManager.currentIndex, { loop: settings.loop });

    if (nextIndex < 0) {
      if (!isContinuousSessionActive(sessionId)) return null;
      flushSkippedToastBatch();
      stopContinuousPlayback();
      showToast('재생목록 재생 완료', 'success');
      return null;
    }

    const nextItem = selectPlaylistItemForContinuous(nextIndex);
    if (!isContinuousSessionActive(sessionId)) return null;
    const ready = await waitForPreparedOrSkip(nextItem, sessionId);
    if (!isContinuousSessionActive(sessionId)) return null;
    if (!ready) {
      return await playNextContinuousItem(sessionId);
    }

    flushSkippedToastBatch();
    const loaded = await loadContinuousPlaylistItem(nextItem, sessionId);
    if (!isContinuousSessionActive(sessionId)) return null;
    if (!loaded) {
      return await playNextContinuousItem(sessionId);
    }
    prepareNextPlaylistItem(sessionId);
    const started = await playContinuousItemWithWatchdog(nextItem, sessionId);
    if (!isContinuousSessionActive(sessionId)) return null;
    if (!started) {
      return await playNextContinuousItem(sessionId);
    }
    return nextItem;
  }

  function setPlaylistMode(mode) {
    const nextMode = mode === 'continuous' ? 'continuous' : 'review';
    playlistUIState.mode = nextMode;

    elements.playlistTabReview?.classList.toggle('active', nextMode === 'review');
    elements.playlistTabContinuous?.classList.toggle('active', nextMode === 'continuous');
    elements.playlistTabReview?.setAttribute('aria-selected', String(nextMode === 'review'));
    elements.playlistTabContinuous?.setAttribute('aria-selected', String(nextMode === 'continuous'));

    if (elements.playlistContinuousTools) {
      elements.playlistContinuousTools.hidden = nextMode !== 'continuous';
    }
    if (elements.playlistPrepareSummary) {
      elements.playlistPrepareSummary.hidden = nextMode !== 'continuous';
    }

    if (nextMode === 'review') {
      stopContinuousPlayback({ keepCurrentVideo: true });
      resetPlaylistContinuousTimelineState();
      renderCommentRanges();
      updateTimelineMarkers();
      updateCommentList();
    } else {
      timeline.clearCommentMarkers();
      updatePlaylistContinuousTimeline();
    }
  }

  function exitPlaylistContinuousModeForCutlist() {
    if (
      playlistUIState.mode !== 'continuous' &&
      !continuousPlaybackState.active &&
      !timeline.playlistDuration
    ) {
      return;
    }

    setPlaylistMode('review');
  }

  async function refreshPlaylistModifiedTimes() {
    const playlistManager = getPlaylistManager();
    const items = playlistManager.getItems();
    for (const item of items) {
      try {
        const stats = await window.electronAPI.getFileStats(item.videoPath);
        item.modifiedAtMs = Number(stats?.mtimeMs) || 0;
      } catch (error) {
        item.modifiedAtMs = 0;
        log.warn('재생목록 수정 날짜 조회 실패', {
          filePath: item.videoPath,
          error: error?.message || error
        });
      }
    }
  }

  function applyPlaylistSortPreservingSelection(sortMode) {
    const playlistManager = getPlaylistManager();
    const currentItemId = playlistManager.getCurrentItem()?.id || null;

    playlistManager.setSortMode(sortMode);
    if (currentItemId) {
      suppressPlaylistSelectionLoad = true;
      try {
        playlistManager.selectItemById(currentItemId);
      } finally {
        suppressPlaylistSelectionLoad = false;
      }
    }
  }

  async function refreshModifiedSortIfActive(options = {}) {
    const shouldContinue = typeof options.shouldContinue === 'function'
      ? options.shouldContinue
      : () => true;
    const playlistManager = getPlaylistManager();
    const continuousSettings = playlistManager.getContinuousSettings();
    if (
      continuousSettings?.sortMode !== 'modifiedAt' ||
      continuousSettings?.manualOrder === true
    ) {
      return;
    }

    await refreshPlaylistModifiedTimes();
    if (!shouldContinue()) return false;
    const nextContinuousSettings = playlistManager.getContinuousSettings();
    if (
      nextContinuousSettings?.sortMode !== 'modifiedAt' ||
      nextContinuousSettings?.manualOrder === true
    ) {
      return;
    }

    if (!shouldContinue()) return false;
    applyPlaylistSortPreservingSelection('modifiedAt');
    updatePlaylistUI();
    updatePlaylistContinuousTimeline();
    return true;
  }

  function initCutlistFeature() {
    const cutlistManager = getCutlistManager();

    cutlistManager.onCutlistLoaded = () => {
      updateCutlistUI();
      updateCutlistTimeline();
      preloadNextCutlistMedia(cutlistManager.getCutById(cutlistManager.currentCutId));
      void updateCutlistAggregateComments();
    };

    cutlistManager.onCutlistModified = () => {
      updateCutlistUI();
      updateCutlistTimeline();
      preloadNextCutlistMedia(cutlistManager.getCutById(cutlistManager.currentCutId));
      void updateCutlistAggregateComments();
    };

    cutlistManager.onCutSelected = (cut) => {
      updateCurrentCutDisplay(cut);
      updateCutlistCurrentItem();
      void seekToCut(cut);
    };

    cutlistManager.onError = (error) => {
      showToast(error.message, 'error');
    };

    elements.btnCutlist?.addEventListener('click', () => {
      if (elements.cutlistSidebar?.classList.contains('hidden')) {
        showCutlistSidebar();
        if (!cutlistManager.isActive()) {
          cutlistManager.createNew();
        }
      } else {
        hideCutlistSidebar();
      }
    });

    elements.btnCutlistClose?.addEventListener('click', () => {
      hideCutlistSidebar();
    });

    async function handleCutlistAddClick() {
      try {
        await addCutlistSourcePair();
      } catch (error) {
        showToast(`컷 묶음 소스를 추가할 수 없습니다: ${error.message}`, 'error');
      }
    }

    elements.btnCutlistAdd?.addEventListener('click', () => {
      void handleCutlistAddClick();
    });

    elements.btnCutlistPrimaryAdd?.addEventListener('click', () => {
      void handleCutlistAddClick();
    });

    elements.btnCutlistSave?.addEventListener('click', () => {
      void saveCurrentCutlist();
    });

    elements.btnCutlistCopyLink?.addEventListener('click', async () => {
      const cutlist = cutlistManager.currentCutlist;
      if (!cutlist || !Array.isArray(cutlist.cuts) || cutlist.cuts.length === 0) {
        showToast('컷 묶음에 컷을 먼저 추가해주세요.', 'warning');
        return;
      }

      try {
        const path = await saveCurrentCutlist();
        if (!path) return;

        const windowsPath = String(path).replace(/\//g, '\\');
        const fileName = windowsPath.split('\\').pop() || '컷 묶음.bcutlist';
        const clipboardContent = `${windowsPath}\n\n${fileName}`;
        await window.electronAPI.copyToClipboard(clipboardContent);
        showToast('컷 묶음 경로가 복사되었습니다! Slack에서 Ctrl+Shift+V로 하이퍼링크 붙여넣기', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });

    elements.cutlistNameInput?.addEventListener('change', (event) => {
      cutlistManager.setName(event.target.value);
    });

    elements.cutlistShowMissing?.addEventListener('change', (event) => {
      cutlistManager.setShowMissingScenes(event.target.checked);
    });

    window.electronAPI.onOpenCutlist?.(async (path) => {
      log.info('컷 묶음 링크로 열기', { path });

      try {
        await openCutlistFile(path);
      } catch (error) {
        showToast(`컷 묶음을 열 수 없습니다: ${error.message}`, 'error');
      }
    });
  }

  async function addCutlistSourcePair() {
    const txtResult = await window.electronAPI.openFileDialog({
      title: 'Moho info txt 선택',
      filters: [{ name: 'Moho info txt', extensions: ['txt'] }],
      properties: ['openFile']
    });
    if (txtResult.canceled || txtResult.filePaths.length === 0) return false;

    const infoFileNameForDialog = getDialogFileName(txtResult.filePaths[0]);
    const videoResult = await window.electronAPI.openFileDialog({
      title: `${infoFileNameForDialog} 이름의 영상을 찾아주세요`,
      filters: [{ name: '미디어 파일', extensions: SUPPORTED_MEDIA_EXTENSIONS }],
      properties: ['openFile']
    });
    if (videoResult.canceled || videoResult.filePaths.length === 0) return false;

    const cutlistManager = getCutlistManager();
    if (!cutlistManager.isActive()) {
      cutlistManager.createNew();
    }

    const result = await cutlistManager.addSourcePair(txtResult.filePaths[0], videoResult.filePaths[0]);
    cutlistUIState.lastIgnored = result.ignored || [];
    updateCutlistUI();
    updateCutlistTimeline();
    void updateCutlistAggregateComments();

    if (!cutlistManager.currentCutId && result.cuts.length > 0) {
      cutlistManager.selectCut(result.cuts[0].id);
    }

    showToast(`${result.cuts.length}개 컷을 추가했습니다.`, 'success');
    return result;
  }

  function showCutlistSidebar() {
    exitPlaylistContinuousModeForCutlist();
    hidePlaylistSidebar();
    cutlistUIState.active = true;
    elements.cutlistSidebar?.classList.remove('hidden');
    elements.btnCutlist?.classList.add('active');
    updateCutlistUI();
    updateCutlistTimeline();
    const currentCut = refreshCurrentCutFromPlayback(videoPlayer.currentFrame);
    updateCurrentCutDisplay(currentCut);
    void refreshCommentRangesForCurrentMode();
    updateCommentList(getActiveCommentFilter());
  }

  function hideCutlistSidebar() {
    cutlistUIState.active = false;
    cutlistCommentTimelineUpdateToken += 1;
    cutlistAggregateCommentRanges = [];
    clearCutlistMediaPreload();
    elements.cutlistSidebar?.classList.add('hidden');
    elements.btnCutlist?.classList.remove('active');
    updateCurrentCutDisplay(null);
    timeline.setCurrentCutId(null);
    timeline.setCutlistTimeline([], 0);
    void refreshCommentRangesForCurrentMode();
    updateCommentList(getActiveCommentFilter());
  }

  function updateCutlistUI() {
    const cutlistManager = getCutlistManager();
    const cutlist = cutlistManager.currentCutlist;
    const hasCutlist = !!cutlist;
    const cutCount = cutlist?.cuts?.length || 0;
    const sourceCount = cutlist?.sources?.length || 0;

    elements.cutlistSidebar?.classList.toggle('empty', !hasCutlist || cutCount === 0);

    if (elements.cutlistNameInput && document.activeElement !== elements.cutlistNameInput) {
      elements.cutlistNameInput.value = cutlist?.name || '새 컷 묶음';
    }

    if (elements.cutlistShowMissing) {
      elements.cutlistShowMissing.checked = cutlist?.settings?.showMissingScenes === true;
    }

    if (elements.cutlistSummary) {
      elements.cutlistSummary.textContent = hasCutlist
        ? `${sourceCount}개 소스 · ${cutCount}개 컷`
        : '0개 소스 · 0개 컷';
    }

    if (elements.cutlistEmpty) {
      elements.cutlistEmpty.hidden = hasCutlist && cutCount > 0;
    }

    renderCutlistItems();
    renderCutlistIgnoredSummary();
  }

  function renderCutlistItems() {
    const cutlistManager = getCutlistManager();
    if (!elements.cutlistItems) return;

    elements.cutlistItems.innerHTML = '';

    if (!cutlistManager.currentCutlist) return;

    for (const row of cutlistManager.getRows()) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'cutlist-item';
      item.dataset.cutId = row.id;

      if (row.missing) {
        item.classList.add('missing', 'cutlist-missing-row');
        item.disabled = true;
        item.innerHTML = `
          <div class="cutlist-item-main">
            <span class="cutlist-item-label">${escapeHtml(row.label)}</span>
            <span class="cutlist-item-frames">누락</span>
          </div>
        `;
        elements.cutlistItems.appendChild(item);
        continue;
      }

      const source = cutlistManager.getSourceById(row.sourceId);
      const sourceMissing = source?.missing === true;
      const frameCount = Math.max(0, Number(row.endFrame) - Number(row.startFrame) + 1);
      const sourceStatus = sourceMissing
        ? '<span class="cutlist-item-status">파일 없음</span>'
        : '';

      item.classList.toggle('active', row.id === cutlistManager.currentCutId);
      item.classList.toggle('missing', sourceMissing);
      item.title = sourceMissing
        ? `${source?.fileName || '출력 영상'} 파일을 찾을 수 없습니다.`
        : `${row.label} - ${source?.fileName || ''}`;
      item.innerHTML = `
        <div class="cutlist-item-main">
          <span class="cutlist-item-label">${escapeHtml(row.label)}</span>
          <span class="cutlist-item-frames">${frameCount}f</span>
        </div>
        <div class="cutlist-item-source-row">
          <span class="cutlist-item-source">${escapeHtml(source?.fileName || '출력 영상')}</span>
          ${sourceStatus}
        </div>
        <div class="cutlist-item-ranges">
          <span>BAEFRAME ${formatCutlistFrameRange(row.startFrame, row.endFrame)}</span>
          <span>Moho ${formatCutlistFrameRange(row.mohoStartFrame, row.mohoEndFrame)}</span>
        </div>
      `;

      item.addEventListener('click', () => {
        cutlistManager.selectCut(row.id);
      });

      elements.cutlistItems.appendChild(item);
    }
  }

  function renderCutlistIgnoredSummary() {
    if (!elements.cutlistIgnoredSummary) return;

    const cutlistManager = getCutlistManager();
    const ignoredCount = cutlistUIState.lastIgnored.length ||
      (cutlistManager.currentCutlist?.sources || []).reduce((sum, source) => (
        sum + (Array.isArray(source.ignoredLabels) ? source.ignoredLabels.length : 0)
      ), 0);

    elements.cutlistIgnoredSummary.hidden = ignoredCount === 0;
    elements.cutlistIgnoredSummary.textContent = ignoredCount > 0
      ? `무시된 라벨 ${ignoredCount}개`
      : '';
  }

  function updateCutlistCurrentItem() {
    const currentCutId = getCutlistManager().currentCutId;
    elements.cutlistItems?.querySelectorAll('.cutlist-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.cutId === currentCutId);
    });
  }

  function updateCurrentCutDisplay(cut) {
    if (!elements.currentCutOverlay) return;

    if (!cut || !cutlistUIState.active) {
      elements.currentCutOverlay.hidden = true;
      elements.currentCutOverlay.textContent = '';
      scheduleMpvOverlayStateSync();
      return;
    }

    elements.currentCutOverlay.hidden = false;
    elements.currentCutOverlay.textContent = `${cut.label} · BAEFRAME ${formatCutlistFrameRange(cut.startFrame, cut.endFrame)}`;
    scheduleMpvOverlayStateSync();
  }

  function getCurrentCutlistSourceForFile(filePath) {
    const normalizedPath = normalizeComparableFilePath(filePath);
    if (!normalizedPath) return null;
    const sources = getCutlistManager().currentCutlist?.sources || [];
    return sources.find(source => (
      normalizeComparableFilePath(source.videoPath) === normalizedPath
    )) || null;
  }

  function getCutlistSegmentForCut(cut) {
    if (!cut?.id) return null;
    return getCutlistManager().getTimeline().segments.find(segment => segment.cutId === cut.id) || null;
  }

  function getCutlistGlobalTimeForCutFrame(cut, frame) {
    const segment = getCutlistSegmentForCut(cut);
    if (!segment) return null;
    const fps = segment.fps || cut.fps || videoPlayer.fps || 24;
    const sourceStartFrame = Number(segment.sourceStartFrame ?? cut.startFrame) || 0;
    const frameCount = Math.max(1, Number(segment.frameCount) || 1);
    const localFrame = Math.max(0, Math.min(Number(frame) - sourceStartFrame, frameCount - 1));
    return (Number(segment.globalStartTime) || 0) + (localFrame / fps);
  }

  function getCutlistTimelinePlaybackTime(frame = videoPlayer.currentFrame, fallbackTime = videoPlayer.currentTime) {
    if (!cutlistUIState.active || !getCutlistManager().isActive()) return fallbackTime;
    const source = getCurrentCutlistSourceForFile(state.currentFile);
    if (!source) return fallbackTime;
    const cutlistManager = getCutlistManager();
    const selectedCut = cutlistManager.getCutById(cutlistManager.currentCutId);
    const cut = (isCutlistPlaybackLockedToSelectedCut() || cutlistPlaybackTransitioning) && selectedCut
      ? selectedCut
      : findCurrentCut(cutlistManager.getOrderedCuts(), {
        sourceId: source.id,
        frame
      });
    const globalTime = getCutlistGlobalTimeForCutFrame(cut, frame);
    return Number.isFinite(globalTime) ? globalTime : fallbackTime;
  }

  function getActiveTimelinePlaybackTime(currentTime = videoPlayer.currentTime, currentFrame = videoPlayer.currentFrame) {
    if (playlistUIState.mode === 'continuous') {
      return getContinuousTimelinePlaybackTime(currentTime);
    }
    if (cutlistUIState.active) {
      return getCutlistTimelinePlaybackTime(currentFrame, currentTime);
    }
    return currentTime;
  }

  function setCutlistCurrentCut(cut) {
    const cutlistManager = getCutlistManager();
    cutlistManager.currentCutId = cut?.id || null;
    updateCurrentCutDisplay(cut || null);
    updateCutlistCurrentItem();
    timeline.setCurrentCutId(cut?.id || null);
    preloadNextCutlistMedia(cut);
  }

  function isFrameInsideCut(cut, frame) {
    const currentFrame = Number(frame);
    const startFrame = Number(cut?.startFrame);
    const endFrame = Number(cut?.endFrame);
    return Number.isFinite(currentFrame) &&
      Number.isFinite(startFrame) &&
      Number.isFinite(endFrame) &&
      currentFrame >= startFrame &&
      currentFrame <= endFrame;
  }

  function isCutlistPlaybackLockedToSelectedCut() {
    return cutlistUIState.active &&
      videoPlayer.isPlaying &&
      !cutlistPlaybackTransitioning &&
      !!getCutlistManager().currentCutId;
  }

  function getNextCutlistCut(cut) {
    if (!cut?.id) return null;
    const cuts = getCutlistManager().getOrderedCuts();
    const index = cuts.findIndex(item => item.id === cut.id);
    if (index < 0) return null;
    return cuts[index + 1] || null;
  }

  async function advanceCutlistPlaybackFromCut(cut, options) {
    const nextCut = getNextCutlistCut(cut);
    if (!nextCut) {
      videoPlayer.pause();
      timeline.setPlayingState(false);
      getAudioWaveform()?.setPlaying(false);
      return false;
    }

    const playbackOptions = options || {};
    const shouldResume = playbackOptions.resume !== false;
    const moved = await seekPlaybackToCutStart(nextCut);
    if (!moved) {
      videoPlayer.pause();
      timeline.setPlayingState(false);
      getAudioWaveform()?.setPlaying(false);
      return false;
    }

    if (shouldResume) {
      await videoPlayer.play();
    }
    return true;
  }

  async function handleCutlistPlaybackFrame(frame) {
    if (
      !cutlistUIState.active ||
      !getCutlistManager().isActive() ||
      !videoPlayer.isPlaying ||
      cutlistPlaybackTransitioning
    ) {
      return false;
    }

    const cutlistManager = getCutlistManager();
    const currentCut = cutlistManager.getCutById(cutlistManager.currentCutId);
    if (!currentCut) {
      refreshCurrentCutFromPlayback(frame);
      return false;
    }

    if (isFrameInsideCut(currentCut, frame)) return false;

    const currentFrame = Number(frame);
    const endFrame = Number(currentCut.endFrame);
    if (!Number.isFinite(currentFrame) || !Number.isFinite(endFrame) || currentFrame <= endFrame) {
      return false;
    }

    cutlistPlaybackTransitioning = true;
    try {
      return await advanceCutlistPlaybackFromCut(currentCut);
    } finally {
      cutlistPlaybackTransitioning = false;
    }
  }

  async function seekPlaybackToCutStart(cut) {
    const segment = getCutlistSegmentForCut(cut);
    if (!segment) return false;
    return await seekCutlistTimeline(segment.globalStartTime);
  }

  async function seekCutlistMappedPosition(mapped) {
    if (!mapped?.segment) return false;
    const cutlistManager = getCutlistManager();
    const cut = cutlistManager.getCutById(mapped.segment.cutId) || mapped.segment.cut;
    if (!cut) return false;

    const source = await resolveCutlistSourceForPlayback(cut);
    if (!source?.videoPath) return false;

    setCutlistCurrentCut(cut);

    const frame = Math.max(0, Number(mapped.sourceFrame) || Number(cut.startFrame) || 0);
    const fps = videoPlayer.fps || mapped.segment.fps || cut.fps || 24;
    const globalTime = (Number(mapped.segment.globalStartTime) || 0) + (Number(mapped.localTime) || 0);

    if (!isSameFilePath(state.currentFile, source.videoPath)) {
      const loaded = await loadVideo(source.videoPath, {
        initialFrame: frame,
        revealAfterInitialSeek: true,
        holdPreviousFrameUntilReady: true,
        deferCollaborationStart: true
      });
      if (!loaded) return false;
    }

    videoPlayer.seekToFrame(frame);
    playbackSync.broadcastSeek(frame / fps);
    timeline.setCurrentTime(globalTime);
    refreshCurrentCutFromPlayback(frame);
    await refreshCommentRangesForCurrentMode();
    updateCommentList(getActiveCommentFilter());
    return true;
  }

  async function seekCutlistTimeline(globalTime) {
    const mapped = mapGlobalTimeToCut(getCutlistManager().getTimeline().segments, globalTime);
    return seekCutlistMappedPosition(mapped);
  }

  function refreshCurrentCutFromPlayback(frame = videoPlayer.currentFrame) {
    if (!cutlistUIState.active) return null;
    const cutlistManager = getCutlistManager();
    if (!cutlistManager.isActive()) {
      setCutlistCurrentCut(null);
      return null;
    }

    const lockedCut = cutlistManager.getCutById(cutlistManager.currentCutId);
    if ((isCutlistPlaybackLockedToSelectedCut() || cutlistPlaybackTransitioning) && lockedCut) {
      return lockedCut;
    }

    const source = getCurrentCutlistSourceForFile(state.currentFile);
    if (!source) {
      setCutlistCurrentCut(null);
      return null;
    }

    const currentCut = findCurrentCut(cutlistManager.getOrderedCuts(), {
      sourceId: source.id,
      frame
    });
    const nextCutId = currentCut?.id || null;
    if ((cutlistManager.currentCutId || null) !== nextCutId) {
      setCutlistCurrentCut(currentCut);
    }
    return currentCut;
  }

  function updateCutlistTimeline() {
    const cutlistManager = getCutlistManager();
    if (!cutlistUIState.active || !cutlistManager.isActive()) {
      timeline.setCurrentCutId(null);
      timeline.setCutlistTimeline([], 0);
      cutlistAggregateCommentRanges = [];
      return;
    }

    const cutlistTimeline = cutlistManager.getTimeline();
    timeline.setCutlistTimeline(cutlistTimeline.segments, cutlistTimeline.totalDuration);
    timeline.setCurrentCutId(cutlistManager.currentCutId);
  }

  async function updateCutlistAggregateComments() {
    const cutlistManager = getCutlistManager();
    const updateToken = ++cutlistCommentTimelineUpdateToken;
    if (!cutlistUIState.active || !cutlistManager.isActive()) {
      cutlistAggregateCommentRanges = [];
      if (cutlistUIState.active) {
        renderCommentRanges();
        updateTimelineMarkers();
        renderCutlistAggregateCommentList(commentFilterState.status);
      }
      return;
    }

    const cutlistTimeline = cutlistManager.getTimeline();
    const sourcesById = new Map(
      (cutlistManager.currentCutlist?.sources || []).map(source => [source.id, source])
    );
    const bframeCache = new Map();
    const aggregateRanges = [];

    for (const segment of cutlistTimeline.segments) {
      if (cutlistCommentTimelineUpdateToken !== updateToken || !cutlistUIState.active) return;

      const source = sourcesById.get(segment.sourceId);
      if (!source?.videoPath) continue;

      const bframePath = getBframePath(source.videoPath);
      let bframeData = bframeCache.get(bframePath);
      if (!bframeCache.has(bframePath)) {
        try {
          bframeData = await window.electronAPI.loadReview(bframePath);
        } catch (error) {
          log.warn('컷 묶음 댓글 로드 실패', {
            fileName: source.fileName || segment.label,
            error: error.message
          });
          bframeData = null;
        }
        bframeCache.set(bframePath, bframeData);
      }

      if (cutlistCommentTimelineUpdateToken !== updateToken || !cutlistUIState.active) return;
      if (!bframeData) continue;

      const ranges = extractCutlistCommentRanges({
        bframeData,
        segment: {
          ...segment,
          fileName: source.fileName || segment.label || '',
          sourceVideoPath: source.videoPath
        },
        visibleLayerIds: null,
        allowedAuthorIds: null
      }).map(range => ({
        ...range,
        aggregateCommentKey: getCutlistAggregateCommentKey(range)
      }));
      aggregateRanges.push(...ranges);
    }

    if (cutlistCommentTimelineUpdateToken !== updateToken || !cutlistUIState.active) return;

    cutlistAggregateCommentRanges = aggregateRanges;
    renderCommentRanges();
    updateTimelineMarkers();
    renderCutlistAggregateCommentList(commentFilterState.status);
  }

  async function seekToCut(cut) {
    if (!cut) return false;
    const source = await resolveCutlistSourceForPlayback(cut);
    if (!source?.videoPath) return false;

    setCutlistCurrentCut(cut);

    if (!isSameFilePath(state.currentFile, source.videoPath)) {
      const loaded = await loadVideo(source.videoPath, {
        initialFrame: Number(cut.startFrame),
        revealAfterInitialSeek: true,
        holdPreviousFrameUntilReady: true,
        deferCollaborationStart: true
      });
      if (!loaded) return false;
    }

    await seekPlaybackToCutStart(cut);
    return true;
  }

  async function resolveCutlistSourceForPlayback(cut) {
    const cutlistManager = getCutlistManager();
    let source = cutlistManager.getSourceById(cut?.sourceId);
    if (!source) {
      showToast('컷의 원본 영상을 찾을 수 없습니다.', 'error');
      return null;
    }

    let exists = source.missing !== true && !!source.videoPath;
    if (exists && window.electronAPI.fileExists) {
      try {
        exists = await window.electronAPI.fileExists(source.videoPath);
      } catch (error) {
        log.warn('컷 묶음 소스 파일 확인 실패', { fileName: source.fileName, error: error.message });
      }
    }

    if (exists) return source;

    const result = await window.electronAPI.openFileDialog({
      title: `${source.fileName || '출력 영상'} 다시 연결`,
      filters: [{ name: '미디어 파일', extensions: SUPPORTED_MEDIA_EXTENSIONS }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const reconnected = await cutlistManager.reconnectSource(source.id, result.filePaths[0]);
    if (!reconnected) return null;
    source = cutlistManager.getSourceById(source.id);

    if (window.electronAPI.fileExists) {
      const reconnectedExists = await window.electronAPI.fileExists(source.videoPath);
      if (!reconnectedExists) {
        showToast('다시 연결한 파일을 찾을 수 없습니다.', 'error');
        return null;
      }
    }

    updateCutlistUI();
    updateCutlistTimeline();
    return source;
  }

  async function ensureCutlistCommentTargetReady() {
    if (!cutlistUIState.active) return true;
    const cutlistManager = getCutlistManager();
    if (!cutlistManager.isActive()) return true;

    const cut = cutlistManager.getCutById(cutlistManager.currentCutId);
    if (!cut) {
      showToast('댓글을 달 컷을 먼저 선택하세요.', 'warning');
      return false;
    }

    const source = await resolveCutlistSourceForPlayback(cut);
    if (!source?.videoPath) return false;

    if (isSameFilePath(state.currentFile, source.videoPath)) {
      if (isFrameInsideCut(cut, videoPlayer.currentFrame)) {
        refreshCurrentCutFromPlayback(videoPlayer.currentFrame);
        const globalTime = getCutlistGlobalTimeForCutFrame(cut, videoPlayer.currentFrame);
        if (Number.isFinite(globalTime)) {
          timeline.setCurrentTime(globalTime);
        }
        return true;
      }

      await seekPlaybackToCutStart(cut);
      return true;
    }

    const loaded = await loadVideo(source.videoPath, {
      initialFrame: Number(cut.startFrame),
      revealAfterInitialSeek: true,
      holdPreviousFrameUntilReady: true,
      deferCollaborationStart: true
    });
    if (!loaded) return false;

    await seekPlaybackToCutStart(cut);
    return true;
  }

  function formatCutlistFrameRange(startFrame, endFrame) {
    const start = Number.isFinite(Number(startFrame)) ? Number(startFrame) : 0;
    const end = Number.isFinite(Number(endFrame)) ? Number(endFrame) : start;
    return `${start} - ${end}f`;
  }

  function initPlaylistFeature() {
    const playlistManager = getPlaylistManager();

    // 콜백 설정
    playlistManager.onPlaylistLoaded = async (playlist, loadContext = {}) => {
      log.info('재생목록 로드됨', { name: playlist.name });
      await refreshModifiedSortIfActive({ shouldContinue: loadContext.shouldContinue });
      if (loadContext.shouldContinue?.() === false) return;
      updatePlaylistUI();
      if (loadContext.shouldContinue?.() === false) return;

      // 모든 아이템의 코덱을 확인하고 필요한 것들을 사전 변환
      preTranscodePlaylistItems();
      preloadNextPlaylistMedia();
    };

    playlistManager.onPlaylistModified = () => {
      updatePlaylistUI();
      updatePlaylistContinuousTimeline();
      preloadNextPlaylistMedia();
      // 자동 저장 (딜레이)
      clearTimeout(playlistManager._autoSaveTimeout);
      playlistManager._autoSaveTimeout = setTimeout(async () => {
        if (playlistManager.isModified) {
          if (playlistManager.playlistPath) {
            try {
              await playlistManager.save();
              log.info('재생목록 자동 저장');
            } catch (err) {
              log.warn('재생목록 자동 저장 실패', err);
            }
          } else if (playlistManager.getItemCount() > 0) {
            // 경로 없는 경우: save()가 첫 아이템 기준으로 경로를 자동 생성
            try {
              await playlistManager.save();
              log.info('재생목록 최초 자동 저장 완료');
            } catch (err) {
              // 저장 경로 생성 실패 시 localStorage로 대체
              playlistManager._saveToLocalStorage();
            }
          }
        }
      }, 2000);
    };

    playlistManager.onItemSelected = async (item, index) => {
      log.info('재생목록 아이템 선택', { index, fileName: item.fileName });
      const selectionLoadToken = ++playlistSelectionLoadToken;
      const shouldContinuePlaylistSelectionLoad = () => (
        selectionLoadToken === playlistSelectionLoadToken &&
        playlistManager.getCurrentItem()?.id === item.id
      );
      const shouldAutoPlaySelectedItem = playlistAutoPlayAfterSelection && userSettings.getPlaylistAutoPlay();
      playlistAutoPlayAfterSelection = false;
      if (suppressPlaylistSelectionLoad) {
        updatePlaylistCurrentItem();
        updatePlaylistPosition();
        return;
      }

      const loaded = await loadVideoFromPlaylist(item, {
        playWhenMediaReady: shouldAutoPlaySelectedItem,
        shouldContinue: shouldContinuePlaylistSelectionLoad
      });
      if (!shouldContinuePlaylistSelectionLoad()) return;
      updatePlaylistCurrentItem();
      updatePlaylistPosition();
      updatePlaylistContinuousTimeline();

      if (loaded && shouldAutoPlaySelectedItem) {
        await playPlaylistSelectedItemImmediately(item);
      }

      // 다음 아이템 사전 변환 트리거
      preTranscodePlaylistItems();
      preloadNextPlaylistMedia();
    };

    playlistManager.onPlaylistClosed = () => {
      playlistSelectionLoadToken += 1;
      clearPlaylistMediaPreload();
      resetPlaylistContinuousTimelineState();
      hidePlaylistSidebar();
    };

    playlistManager.onError = (error) => {
      showToast(error.message, 'error');
    };

    // 리뷰 데이터 저장 시 재생목록 진행률 업데이트
    reviewDataManager.addEventListener('saved', async (e) => {
      if (playlistManager.isActive()) {
        // 현재 아이템의 bframePath 업데이트 (새로 생성된 경우)
        const currentItem = playlistManager.getCurrentItem();
        if (currentItem && (!currentItem.bframePath || currentItem.bframePath === '')) {
          currentItem.bframePath = e.detail.path;
          playlistManager.isModified = true;
        }

        // 현재 아이템의 진행률 업데이트
        await refreshVisiblePlaylistProgress(e.detail.path);
        updatePlaylistContinuousTimeline();
      }
    });

    // 헤더 재생목록 버튼
    elements.btnPlaylist?.addEventListener('click', async () => {
      if (elements.playlistSidebar.classList.contains('hidden')) {
        showPlaylistSidebar();
        if (!playlistManager.isActive()) {
          // localStorage에서 임시 저장된 재생목록 복원 시도
          const tempData = playlistManager._restoreFromLocalStorage();
          if (tempData) {
            playlistManager.currentPlaylist = tempData.playlist;
            playlistManager.currentIndex = tempData.currentIndex;
            playlistManager.isModified = true;
            playlistManager._clearLocalStorage();
            playlistManager.onPlaylistLoaded?.(playlistManager.currentPlaylist);
            log.info('임시 저장된 재생목록 복원');
          } else {
            playlistManager.createNew();
            // 현재 영상이 있으면 추가 (state.currentFile은 문자열)
            if (state.currentFile) {
              try {
                await playlistManager.addItems([state.currentFile]);
                await refreshModifiedSortIfActive();
                updatePlaylistUI();
              } catch (error) {
                showToast(error.message, 'error');
              }
            }
          }
        }
      } else {
        hidePlaylistSidebar();
      }
    });

    // 닫기 버튼
    elements.btnPlaylistClose?.addEventListener('click', () => {
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
        title: '재생목록에 추가할 영상 또는 재생목록 선택',
        filters: getSupportedPlaylistDialogFilters(),
        properties: ['openFile', 'multiSelections']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        try {
          const playlistPath = result.filePaths.find(isPlaylistFilePath);
          if (playlistPath) {
            await openPlaylistFile(playlistPath);
            exitPlaylistAddMode();
            showToast('재생목록을 열었습니다.', 'success');
            return;
          }

          const cutlistPath = result.filePaths.find(isCutlistFilePath);
          if (cutlistPath) {
            await openCutlistFile(cutlistPath);
            exitPlaylistAddMode();
            showToast('컷 묶음을 열었습니다.', 'success');
            return;
          }

          await playlistManager.addItems(result.filePaths);
          await refreshModifiedSortIfActive();
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

        // .bframe과 동일한 형식으로 클립보드에 복사 (여러 줄)
        // Slack이 1줄짜리 파일 경로를 자동완성하는 문제 방지
        const windowsPath = playlistManager.playlistPath.replace(/\//g, '\\');
        const fileName = windowsPath.split('\\').pop() || '재생목록.bplaylist';
        const clipboardContent = `${windowsPath}\n\n${fileName}`;
        await window.electronAPI.copyToClipboard(clipboardContent);
        showToast('재생목록 경로가 복사되었습니다! Slack에서 Ctrl+Shift+V로 하이퍼링크 붙여넣기', 'success');
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
      userSettings.setPlaylistAutoPlay(e.target.checked);
      preloadNextPlaylistMedia();
    });

    elements.playlistTabReview?.addEventListener('click', () => {
      setPlaylistMode('review');
    });

    elements.playlistTabContinuous?.addEventListener('click', () => {
      setPlaylistMode('continuous');
    });

    elements.playlistSortMode?.addEventListener('change', async (e) => {
      const sortMode = e.target.value;
      const sortChangeToken = ++playlistSortChangeToken;
      if (sortMode === 'modifiedAt') {
        await refreshPlaylistModifiedTimes();
        if (
          playlistSortChangeToken !== sortChangeToken ||
          elements.playlistSortMode?.value !== sortMode
        ) {
          return;
        }
      }

      applyPlaylistSortPreservingSelection(sortMode);
      updatePlaylistUI();
      updatePlaylistContinuousTimeline();
    });

    elements.playlistContinuousLoop?.addEventListener('change', (e) => {
      playlistManager.setContinuousLoop(e.target.checked);
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
        await openPlaylistFile(path);
      } catch (error) {
        showToast(`재생목록을 열 수 없습니다: ${error.message}`, 'error');
      }
    });
  }

  // 재생목록에서 영상 로드
  async function loadVideoFromPlaylist(item, options = {}) {
    const { shouldContinue = null, ...loadOptions } = options;
    const canContinuePlaylistLoad = () => typeof shouldContinue !== 'function' || shouldContinue();
    if (!canContinuePlaylistLoad()) return false;

    // 파일 존재 확인
    const exists = await window.electronAPI.fileExists(item.videoPath);
    if (!canContinuePlaylistLoad()) return false;
    if (!exists) {
      showToast(`파일을 찾을 수 없습니다: ${item.fileName}`, 'error');
      markPlaylistItemAsMissing(item.id);
      return false;
    }

    // 현재 영상 저장
    if (reviewDataManager.isModified) {
      await reviewDataManager.save();
      if (!canContinuePlaylistLoad()) return false;
    }

    // 새 영상 로드
    if (!canContinuePlaylistLoad()) return false;
    const loaded = await loadVideo(item.videoPath, {
      ...loadOptions,
      shouldContinue: canContinuePlaylistLoad
    });
    if (!canContinuePlaylistLoad()) return false;
    return loaded === true;
  }

  async function playPlaylistSelectedItemImmediately(item) {
    if (videoPlayer.isPlaying) return true;
    if (
      playlistMediaPreload.itemId === item?.id &&
      playlistMediaPreload.ready === true
    ) {
      log.debug('사전 로드된 재생목록 미디어 재생 시도', { fileName: item?.fileName });
    }

    return playVideoAfterMediaLoad({
      silent: false,
      warningMessage: '다음 영상을 자동으로 재생할 수 없습니다.',
      logContext: { fileName: item?.fileName }
    });
  }

  async function playVideoAfterMediaLoad(options = {}) {
    const {
      silent = false,
      warningMessage = '영상을 자동으로 재생할 수 없습니다.',
      logContext = {}
    } = options;

    const started = await videoPlayer.play();
    if (started || videoPlayer.isPlaying) return true;

    await waitForContinuousMediaReady(250);
    const retryStarted = await videoPlayer.play();
    if (retryStarted || videoPlayer.isPlaying) return true;

    log.warn('미디어 자동재생 시작 실패', logContext);
    if (!silent) {
      showToast(warningMessage, 'warning');
    }
    return false;
  }

  // 사이드바 표시
  function showPlaylistSidebar() {
    hideCutlistSidebar();
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
        elements.playlistAutoPlay.checked = userSettings.getPlaylistAutoPlay();
      }

      const continuousSettings = playlistManager.getContinuousSettings?.();
      if (continuousSettings) {
        if (elements.playlistSortMode) {
          elements.playlistSortMode.value = continuousSettings.sortMode;
        }
        if (elements.playlistContinuousLoop) {
          elements.playlistContinuousLoop.checked = continuousSettings.loop;
        }
      }

      // 아이템 렌더링
      await renderPlaylistItems();

      // 위치 업데이트
      updatePlaylistPosition();

      // 전체 진행률 업데이트
      await updatePlaylistProgress();

      updatePlaylistPrepareSummary();
    } finally {
      isUpdatingPlaylistUI = false;
    }
  }

  function applyPlaylistItemCommentState(el, progress) {
    if (!el) return;
    const total = Math.max(0, Number(progress?.total) || 0);
    const resolved = Math.max(0, Number(progress?.resolved) || 0);
    const unresolved = Math.max(0, total - resolved);
    const hasComments = total > 0;
    const allResolved = hasComments && unresolved === 0;

    el.classList.toggle('has-comments', hasComments);
    el.classList.toggle('has-unresolved-comments', unresolved > 0);
    el.classList.toggle('comments-resolved', allResolved);
    el.dataset.commentState = !hasComments ? 'none' : (allResolved ? 'resolved' : 'unresolved');

    const statusEl = el.querySelector('.playlist-item-comment-state');
    if (statusEl) {
      statusEl.textContent = !hasComments
        ? ''
        : (unresolved > 0 ? `미해결 ${unresolved}` : '모두 해결');
      statusEl.hidden = !hasComments;
    }

    const commentsEl = el.querySelector('.playlist-item-comments');
    if (commentsEl) {
      commentsEl.title = hasComments
        ? `댓글 ${total}개, 해결 ${resolved}개, 미해결 ${unresolved}개`
        : '피드백 없음';
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
    const progressById = new Map(await Promise.all(items.map(async item => [
      item.id,
      await playlistManager.getItemProgress(item)
    ])));

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const progress = progressById.get(item.id) || { total: 0, resolved: 0, percent: 0 };

      const el = document.createElement('div');
      el.className = 'playlist-item' + (i === playlistManager.currentIndex ? ' active' : '');
      el.dataset.id = item.id;
      el.dataset.index = i;
      if (item.continuousStatus) {
        el.dataset.continuousStatus = item.continuousStatus;
      }
      el.draggable = true;

      // 썸네일: 파일 경로 또는 Data URL 지원
      let thumbnailHtml;
      if (item.thumbnailPath) {
        const isDataUrl = item.thumbnailPath.startsWith('data:');
        const thumbnailSrc = isDataUrl
          ? item.thumbnailPath
          : `file://${item.thumbnailPath.replace(/\\/g, '/')}`;
        thumbnailHtml = `<img src="${thumbnailSrc}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'thumbnail-placeholder\\'></div>'">`;
      } else {
        thumbnailHtml = '<div class="thumbnail-placeholder"></div>';
      }

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
            <span class="playlist-item-comment-state" hidden></span>
            <span class="playlist-item-continuous-status">${item.continuousMessage || ''}</span>
          </div>
        </div>
        <button class="playlist-item-remove" title="제거">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;
      applyPlaylistItemCommentState(el, progress);

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

  // 현재 아이템의 진행률만 업데이트 (실시간)
  async function updatePlaylistItemProgress(bframePath = null) {
    const playlistManager = getPlaylistManager();
    if (!playlistManager.isActive()) return;

    const currentIndex = playlistManager.currentIndex;
    const items = playlistManager.getItems();
    if (currentIndex < 0 || currentIndex >= items.length) return;

    const item = items[currentIndex];
    // bframePath가 전달되면 사용, 아니면 아이템에서 영상 옆 .bframe까지 복구
    const pathToUse = bframePath || item;
    const progress = await playlistManager.getItemProgress(pathToUse);

    // 현재 아이템의 DOM 요소 찾기
    const el = document.querySelector(`.playlist-item[data-index="${currentIndex}"]`);
    if (!el) return;

    // 댓글 수 업데이트
    const commentsEl = el.querySelector('.playlist-item-comments');
    if (commentsEl) {
      const svg = commentsEl.querySelector('svg').outerHTML;
      commentsEl.innerHTML = `${svg}\n              ${progress.total > 0 ? progress.total : '-'}`;
    }

    // 진행률 업데이트
    const progressEl = el.querySelector('.playlist-item-progress');
    if (progressEl) {
      progressEl.className = `playlist-item-progress ${progress.percent === 100 ? 'completed' : ''}`;
      const progressBar = progressEl.querySelector('.mini-progress-fill');
      if (progressBar) {
        progressBar.style.width = `${progress.percent}%`;
      }
      // 퍼센트 텍스트 업데이트
      const textNode = progressEl.lastChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        textNode.textContent = `\n              ${progress.total > 0 ? `${progress.percent}%` : '-'}`;
      }
    }
    applyPlaylistItemCommentState(el, progress);
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

  async function refreshVisiblePlaylistProgress(bframePath = null) {
    const playlistManager = getPlaylistManager();
    if (!playlistManager.isActive?.()) return;

    await updatePlaylistItemProgress(bframePath);
    await updatePlaylistProgress();
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
        e.stopPropagation(); // 메인 드롭존 활성화 방지
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
        e.stopPropagation(); // 메인 드롭존 활성화 방지
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    sidebar.addEventListener('drop', async (e) => {
      dropzone.classList.remove('active');
      exitPlaylistAddMode(); // 추가 모드 해제

      if (!e.dataTransfer.types.includes('Files')) return;

      e.preventDefault();
      e.stopPropagation(); // 메인 영역으로 이벤트 전파 방지

      const files = Array.from(e.dataTransfer.files);
      const playlistPath = files.find(f => isPlaylistFilePath(f.path || f.name))?.path;
      if (playlistPath) {
        try {
          await openPlaylistFile(playlistPath);
          showToast('재생목록을 열었습니다.', 'success');
        } catch (error) {
          showToast(`재생목록을 열 수 없습니다: ${error.message}`, 'error');
        }
        return;
      }

      const cutlistPath = files.find(f => isCutlistFilePath(f.path || f.name))?.path;
      if (cutlistPath) {
        try {
          await openCutlistFile(cutlistPath);
          showToast('컷 묶음을 열었습니다.', 'success');
        } catch (error) {
          showToast(`컷 묶음을 열 수 없습니다: ${error.message}`, 'error');
        }
        return;
      }

      const videoPaths = files
        .filter(f => isMediaFile(f.path))
        .map(f => f.path);

      if (videoPaths.length > 0) {
        const playlistManager = getPlaylistManager();

        if (!playlistManager.isActive()) {
          playlistManager.createNew();
        }

        try {
          const added = await playlistManager.addItems(videoPaths);
          await refreshModifiedSortIfActive();
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
      e.stopPropagation(); // 메인 영역으로 이벤트 전파 방지

      const files = Array.from(e.dataTransfer.files);
      const playlistPath = files.find(f => isPlaylistFilePath(f.path || f.name))?.path;
      if (playlistPath) {
        try {
          await openPlaylistFile(playlistPath);
          exitPlaylistAddMode();
          showToast('재생목록을 열었습니다.', 'success');
        } catch (error) {
          showToast(`재생목록을 열 수 없습니다: ${error.message}`, 'error');
        }
        return;
      }

      const cutlistPath = files.find(f => isCutlistFilePath(f.path || f.name))?.path;
      if (cutlistPath) {
        try {
          await openCutlistFile(cutlistPath);
          exitPlaylistAddMode();
          showToast('컷 묶음을 열었습니다.', 'success');
        } catch (error) {
          showToast(`컷 묶음을 열 수 없습니다: ${error.message}`, 'error');
        }
        return;
      }

      const videoPaths = files
        .filter(f => isMediaFile(f.path))
        .map(f => f.path);

      if (videoPaths.length > 0) {
        const playlistManager = getPlaylistManager();

        if (!playlistManager.isActive()) {
          playlistManager.createNew();
        }

        try {
          const added = await playlistManager.addItems(videoPaths);
          await refreshModifiedSortIfActive();
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

      // 플레이스홀더의 DOM 위치로 새 인덱스 계산
      // 플레이스홀더 앞에 있는 모든 playlist-item 개수를 셈
      let newIndex = 0;
      let sibling = placeholder.previousElementSibling;
      while (sibling) {
        if (sibling.classList.contains('playlist-item') && sibling !== draggedItem) {
          newIndex++;
        }
        sibling = sibling.previousElementSibling;
      }

      placeholder.remove();

      // 드래그한 아이템이 플레이스홀더보다 앞에 있었으면 조정 불필요
      // 뒤에 있었으면 자기 자리가 빠지므로 이미 반영됨
      if (newIndex !== draggedIndex) {
        const playlistManager = getPlaylistManager();
        playlistManager.reorderItem(draggedIndex, newIndex);
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
