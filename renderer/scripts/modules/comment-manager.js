/**
 * baeframe - Comment Manager Module
 * 영상 위 마커 기반 댓글 시스템
 */

import { createLogger } from '../logger.js';
import { getAuthManager } from './auth-manager.js';

const log = createLogger('CommentManager');

// 마커 색상 정의
export const MARKER_COLORS = {
  default: { name: '기본', color: '#4a9eff', bgColor: 'rgba(74, 158, 255, 0.3)' },
  yellow: { name: '노랑', color: '#ffdd59', bgColor: 'rgba(255, 221, 89, 0.3)' },
  red: { name: '빨강', color: '#ff5555', bgColor: 'rgba(255, 85, 85, 0.3)' },
  pink: { name: '핑크', color: '#ff6b9d', bgColor: 'rgba(255, 107, 157, 0.3)' },
  green: { name: '초록', color: '#2ed573', bgColor: 'rgba(46, 213, 115, 0.3)' },
  gray: { name: '회색', color: '#a0a0a0', bgColor: 'rgba(160, 160, 160, 0.3)' },
  white: { name: '흰색', color: '#ffffff', bgColor: 'rgba(255, 255, 255, 0.3)' }
};

/**
 * UUID 생성
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 프레임을 타임코드로 변환
 */
function frameToTimecode(frame, fps = 24) {
  const totalSeconds = frame / fps;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = frame % fps;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

/**
 * 댓글 마커 클래스
 * 영상 위의 특정 위치에 표시되는 댓글
 */
export class CommentMarker {
  constructor(options = {}) {
    this.id = options.id || generateUUID();

    // 위치 (영상 내 상대 좌표, 0~1)
    this.x = options.x || 0;
    this.y = options.y || 0;

    // 시간 범위 (프레임 단위)
    this.startFrame = options.startFrame || 0;
    const fps = options.fps || 24;
    this.endFrame = options.endFrame || (this.startFrame + fps * 4); // 기본 4초
    this.fps = fps;

    // 내용
    this.text = options.text || '';
    this.author = options.author || '익명';
    this.createdAt = options.createdAt || new Date();
    this.updatedAt = options.updatedAt || this.createdAt; // 수정 시간 (협업 머지용)

    // 첨부 이미지 (Base64)
    this.image = options.image || null;
    this.imageWidth = options.imageWidth || null;
    this.imageHeight = options.imageHeight || null;

    // 상태
    this.resolved = options.resolved || false;
    this.resolvedAt = options.resolvedAt ? new Date(options.resolvedAt) : null; // 해결된 시간
    this.pinned = options.pinned || false; // 말풍선 고정 상태
    this.deleted = options.deleted || false; // 삭제됨 (협업 동기화용)
    this.deletedAt = options.deletedAt ? new Date(options.deletedAt) : null; // 삭제 시간

    // 레이어
    this.layerId = options.layerId || 'comment-layer-1';

    // 색상 (개별 마커 색상)
    this.colorKey = options.colorKey || 'default';

    // 답글 (스레드)
    this.replies = options.replies || [];

    // DOM 요소 (렌더링 후 설정)
    this.element = null;
    this.tooltipElement = null;
  }

  /**
   * 답글 추가
   */
  addReply(reply) {
    const newReply = {
      id: generateUUID(),
      text: reply.text,
      author: reply.author || '익명',
      createdAt: new Date()
    };

    // 이미지 첨부 지원
    if (reply.image) {
      newReply.image = reply.image;
      newReply.imageWidth = reply.imageWidth || null;
      newReply.imageHeight = reply.imageHeight || null;
    }

    this.replies.push(newReply);
    return newReply;
  }

  /**
   * 답글 개수
   */
  get replyCount() {
    return this.replies.length;
  }

  /**
   * 시작 타임코드
   */
  get startTimecode() {
    return frameToTimecode(this.startFrame, this.fps);
  }

  /**
   * duration (프레임 수)
   */
  get duration() {
    return this.endFrame - this.startFrame;
  }

  /**
   * 색상 정보 반환
   */
  get colorInfo() {
    return MARKER_COLORS[this.colorKey] || MARKER_COLORS.default;
  }

  /**
   * duration 설정
   */
  setDuration(frames) {
    this.endFrame = this.startFrame + Math.max(1, frames);
  }

  /**
   * 특정 프레임에서 보이는지 확인
   */
  isVisibleAtFrame(frame) {
    return frame >= this.startFrame && frame <= this.endFrame;
  }

  /**
   * 해결 상태 토글
   */
  toggleResolved() {
    this.resolved = !this.resolved;
    // 해결됨으로 변경 시 시간 기록, 미해결로 변경 시 시간 초기화
    this.resolvedAt = this.resolved ? new Date() : null;
    // 변경 시간 갱신 (협업 머지용)
    this.updatedAt = new Date();
    return this.resolved;
  }

  /**
   * 고정 상태 토글
   */
  togglePinned() {
    this.pinned = !this.pinned;
    return this.pinned;
  }

  /**
   * JSON으로 변환
   */
  toJSON() {
    const json = {
      id: this.id,
      x: this.x,
      y: this.y,
      startFrame: this.startFrame,
      endFrame: this.endFrame,
      fps: this.fps,
      text: this.text,
      author: this.author,
      createdAt: this.createdAt instanceof Date ? this.createdAt.toISOString() : this.createdAt,
      updatedAt: this.updatedAt instanceof Date ? this.updatedAt.toISOString() : this.updatedAt,
      resolved: this.resolved,
      resolvedAt: this.resolvedAt instanceof Date ? this.resolvedAt.toISOString() : this.resolvedAt,
      deleted: this.deleted,
      deletedAt: this.deletedAt instanceof Date ? this.deletedAt.toISOString() : this.deletedAt,
      layerId: this.layerId,
      colorKey: this.colorKey,
      replies: this.replies.map(r => ({
        ...r,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt
      }))
    };

    // 이미지가 있으면 포함
    if (this.image) {
      json.image = this.image;
      json.imageWidth = this.imageWidth;
      json.imageHeight = this.imageHeight;
    }

    return json;
  }

  /**
   * JSON에서 생성
   */
  static fromJSON(json) {
    return new CommentMarker({
      ...json,
      createdAt: new Date(json.createdAt),
      updatedAt: json.updatedAt ? new Date(json.updatedAt) : new Date(json.createdAt),
      resolvedAt: json.resolvedAt ? new Date(json.resolvedAt) : null,
      deletedAt: json.deletedAt ? new Date(json.deletedAt) : null,
      replies: (json.replies || []).map(r => ({
        ...r,
        createdAt: new Date(r.createdAt)
      }))
    });
  }
}

/**
 * 댓글 레이어 클래스
 */
export class CommentLayer {
  constructor(options = {}) {
    this.id = options.id || `comment-layer-${generateUUID().slice(0, 8)}`;
    this.name = options.name || '댓글 레이어';
    this.color = options.color || '#ff6b6b';
    this.visible = options.visible !== false;
    this.locked = options.locked || false;
    this.markers = new Map();
  }

  addMarker(marker) {
    marker.layerId = this.id;
    this.markers.set(marker.id, marker);
  }

  removeMarker(markerId) {
    return this.markers.delete(markerId);
  }

  getMarker(markerId) {
    return this.markers.get(markerId);
  }

  getAllMarkers(includeDeleted = false) {
    const markers = Array.from(this.markers.values());
    return includeDeleted ? markers : markers.filter(m => !m.deleted);
  }

  getMarkersAtFrame(frame) {
    return this.getAllMarkers().filter(m => m.isVisibleAtFrame(frame));
  }
}

/**
 * 댓글 매니저 클래스
 */
export class CommentManager extends EventTarget {
  constructor(options = {}) {
    super();

    // 설정
    this.fps = options.fps || 24;
    this.container = options.container; // 마커를 렌더링할 컨테이너
    this.videoElement = options.videoElement;
    this.author = options.author || '익명'; // 기본 작성자

    // 레이어
    this.layers = [];
    this.activeLayerId = null;

    // 상태
    this.isCommentMode = false; // 댓글 추가 모드
    this.pendingMarker = null; // 생성 중인 마커
    this.pendingText = null; // 미리 입력한 텍스트 (역순 플로우)
    this.currentFrame = 0;

    // 기본 레이어 생성
    this._createDefaultLayer();

    log.info('CommentManager 초기화됨');
  }

  /**
   * 기본 레이어 생성
   */
  _createDefaultLayer() {
    const layer = new CommentLayer({
      id: 'comment-layer-1',
      name: '댓글 1',
      color: '#ff6b6b'
    });
    this.layers.push(layer);
    this.activeLayerId = layer.id;
  }

  /**
   * FPS 설정
   */
  setFPS(fps) {
    this.fps = fps;
    log.debug('FPS 설정', { fps });
  }

  /**
   * 컨테이너 설정
   */
  setContainer(container) {
    this.container = container;
  }

  /**
   * 작성자 이름 설정
   */
  setAuthor(author) {
    this.author = author || '익명';
    log.info('작성자 설정됨', { author: this.author });
  }

  /**
   * 작성자 이름 가져오기
   */
  getAuthor() {
    return this.author;
  }

  /**
   * 현재 프레임 설정
   */
  setCurrentFrame(frame) {
    const prevFrame = this.currentFrame;
    this.currentFrame = frame;

    // 프레임이 변경되면 마커 가시성 업데이트
    if (prevFrame !== frame) {
      this._updateMarkersVisibility();
    }
  }

  /**
   * 댓글 모드 토글
   */
  toggleCommentMode() {
    this.isCommentMode = !this.isCommentMode;

    log.info('댓글 모드 변경', { isCommentMode: this.isCommentMode });

    this._emit('commentModeChanged', { isCommentMode: this.isCommentMode });

    // 모드 해제 시 pending 마커 정리
    if (!this.isCommentMode && this.pendingMarker) {
      this._cancelPendingMarker();
    }

    return this.isCommentMode;
  }

  /**
   * 댓글 모드 설정
   */
  setCommentMode(enabled) {
    if (this.isCommentMode !== enabled) {
      this.isCommentMode = enabled;
      this._emit('commentModeChanged', { isCommentMode: this.isCommentMode });

      if (!enabled && this.pendingMarker) {
        this._cancelPendingMarker();
      }

      // 댓글 모드 해제 시 pendingText도 정리
      if (!enabled) {
        this.pendingText = null;
      }
    }
  }

  /**
   * 미리 텍스트 설정 (역순 플로우: 텍스트 입력 → 마커 찍기)
   * @param {string} text - 미리 입력한 댓글 텍스트
   */
  setPendingText(text) {
    if (text && text.trim()) {
      this.pendingText = text.trim();
      this.setCommentMode(true);
      log.info('Pending 텍스트 설정됨', { text: this.pendingText });
      this._emit('pendingTextSet', { text: this.pendingText });
      return true;
    }
    return false;
  }

  /**
   * pending 텍스트 가져오기
   */
  getPendingText() {
    return this.pendingText;
  }

  /**
   * pending 텍스트 정리
   */
  clearPendingText() {
    this.pendingText = null;
  }

  /**
   * 영상 클릭 시 마커 생성 시작
   * @param {number} x - 상대 X 좌표 (0~1)
   * @param {number} y - 상대 Y 좌표 (0~1)
   * @returns {CommentMarker|null} 생성된 마커 또는 null
   */
  startMarkerCreation(x, y) {
    if (!this.isCommentMode) return null;

    // 기존 pending 마커가 있으면 취소
    if (this.pendingMarker) {
      this._cancelPendingMarker();
    }

    // 새 마커 생성
    this.pendingMarker = new CommentMarker({
      x,
      y,
      startFrame: this.currentFrame,
      endFrame: this.currentFrame + this.fps * 4, // 기본 4초
      fps: this.fps,
      layerId: this.activeLayerId,
      author: this.author
    });

    log.info('마커 생성 시작', { x, y, frame: this.currentFrame });

    // 역순 플로우: pendingText가 있으면 바로 마커 확정
    if (this.pendingText) {
      const text = this.pendingText;
      this.pendingText = null;
      log.info('Pending 텍스트로 마커 즉시 확정', { text });
      return this.confirmMarker(text);
    }

    // 일반 플로우: 마커 생성 후 텍스트 입력 대기
    this._emit('markerCreationStarted', { marker: this.pendingMarker });

    return this.pendingMarker;
  }

  /**
   * 마커에 텍스트 설정 및 확정
   */
  confirmMarker(text) {
    if (!this.pendingMarker) {
      log.warn('확정할 마커가 없음');
      return null;
    }

    // 이미지만 있는 경우도 허용
    const hasImage = this._pendingImage && this._pendingImage.base64;
    if ((!text || !text.trim()) && !hasImage) {
      this._cancelPendingMarker();
      return null;
    }

    this.pendingMarker.text = text ? text.trim() : '';

    // 이미지 첨부
    if (hasImage) {
      this.pendingMarker.image = this._pendingImage.base64;
      this.pendingMarker.imageWidth = this._pendingImage.width;
      this.pendingMarker.imageHeight = this._pendingImage.height;
      this._pendingImage = null; // 초기화
    }

    // 활성 레이어에 추가
    const layer = this.getActiveLayer();
    if (layer) {
      layer.addMarker(this.pendingMarker);
    }

    const confirmedMarker = this.pendingMarker;
    this.pendingMarker = null;

    log.info('마커 확정됨', { id: confirmedMarker.id, text: confirmedMarker.text, hasImage: !!confirmedMarker.image });

    this._emit('markerAdded', { marker: confirmedMarker });
    this._emit('markersChanged');

    // 댓글 모드 해제
    this.setCommentMode(false);

    return confirmedMarker;
  }

  /**
   * pending 마커 취소
   */
  _cancelPendingMarker() {
    if (this.pendingMarker) {
      this._emit('markerCreationCancelled', { marker: this.pendingMarker });
      this.pendingMarker = null;
    }
  }

  /**
   * 마커 삭제 (soft delete - 협업 동기화용)
   * 권한 체크: 본인 코멘트만 삭제 가능
   */
  deleteMarker(markerId) {
    const marker = this.getMarker(markerId);
    if (!marker) return false;

    // 권한 체크
    const authManager = getAuthManager();
    if (authManager.isAuthenticated && !authManager.canEditComment(marker)) {
      log.warn('권한 없음: 본인 코멘트만 삭제할 수 있습니다', { markerId, author: marker.author });
      this._emit('permissionDenied', { action: 'delete', marker });
      return false;
    }

    marker.deleted = true;
    marker.deletedAt = new Date();
    marker.updatedAt = new Date(); // 머지 비교용
    log.info('마커 삭제됨 (soft delete)', { id: markerId });
    this._emit('markerDeleted', { markerId });
    this._emit('markersChanged');
    return true;
  }

  /**
   * 마커 완전 삭제 (Map에서 제거)
   */
  hardDeleteMarker(markerId) {
    for (const layer of this.layers) {
      if (layer.removeMarker(markerId)) {
        log.info('마커 완전 삭제됨', { id: markerId });
        return true;
      }
    }
    return false;
  }

  /**
   * JSON 데이터로 마커 복원 (Undo용)
   */
  restoreMarker(markerData) {
    const marker = CommentMarker.fromJSON(markerData);
    const layer = this.layers.find(l => l.id === marker.layerId) || this.getActiveLayer();
    if (layer) {
      layer.addMarker(marker);
      log.info('마커 복원됨', { id: marker.id });
      this._emit('markerAdded', { marker });
      this._emit('markersChanged');
      return marker;
    }
    return null;
  }

  /**
   * 마커 업데이트
   * 권한 체크: resolved 변경은 누구나 가능, 나머지는 본인만
   */
  updateMarker(markerId, updates) {
    const marker = this.getMarker(markerId);
    if (!marker) return null;

    // resolved 변경만 하는 경우는 누구나 가능
    const isOnlyResolved = Object.keys(updates).length === 1 && 'resolved' in updates;

    // resolved 이외의 변경은 본인만 가능
    if (!isOnlyResolved) {
      const authManager = getAuthManager();
      if (authManager.isAuthenticated && !authManager.canEditComment(marker)) {
        log.warn('권한 없음: 본인 코멘트만 수정할 수 있습니다', { markerId, author: marker.author });
        this._emit('permissionDenied', { action: 'update', marker });
        return null;
      }
    }

    // 허용된 필드만 업데이트
    const allowedFields = ['text', 'startFrame', 'endFrame', 'resolved', 'x', 'y', 'colorKey'];
    let hasChanges = false;

    allowedFields.forEach(field => {
      if (updates[field] !== undefined && marker[field] !== updates[field]) {
        marker[field] = updates[field];
        hasChanges = true;
      }
    });

    // 변경이 있으면 updatedAt 갱신 (협업 머지용)
    if (hasChanges) {
      marker.updatedAt = new Date();
    }

    this._emit('markerUpdated', { marker });
    this._emit('markersChanged');

    return marker;
  }

  /**
   * 마커 해결 상태 토글
   */
  toggleMarkerResolved(markerId) {
    const marker = this.getMarker(markerId);
    if (!marker) return null;

    marker.toggleResolved();

    this._emit('markerUpdated', { marker });
    this._emit('markersChanged');

    return marker;
  }

  /**
   * 마커 고정 상태 토글
   */
  toggleMarkerPinned(markerId) {
    const marker = this.getMarker(markerId);
    if (!marker) return null;

    marker.togglePinned();

    this._emit('markerPinnedChanged', { marker });

    return marker;
  }

  /**
   * 마커에 답글 추가
   */
  addReplyToMarker(markerId, replyText, author) {
    const marker = this.getMarker(markerId);
    if (!marker) return null;

    const reply = marker.addReply({
      text: replyText,
      author: author || this.author
    });

    this._emit('replyAdded', { marker, reply });
    this._emit('markersChanged');

    return reply;
  }

  /**
   * 답글 수정
   * 권한 체크: 본인 답글만 수정 가능
   */
  updateReply(markerId, replyId, updates) {
    const marker = this.getMarker(markerId);
    if (!marker) return false;

    const reply = marker.replies?.find(r => r.id === replyId);
    if (!reply) return false;

    // 권한 체크
    const authManager = getAuthManager();
    if (authManager.isAuthenticated && !authManager.canEditComment(reply)) {
      log.warn('권한 없음: 본인 답글만 수정할 수 있습니다', { markerId, replyId, author: reply.author });
      this._emit('permissionDenied', { action: 'updateReply', reply });
      return false;
    }

    if (updates.text !== undefined) {
      reply.text = updates.text;
    }
    marker.updatedAt = new Date();

    this._emit('markerUpdated', { marker });
    this._emit('markersChanged');
    return true;
  }

  /**
   * 답글 삭제
   * 권한 체크: 본인 답글만 삭제 가능
   */
  deleteReply(markerId, replyId) {
    const marker = this.getMarker(markerId);
    if (!marker) return false;

    const replyIndex = marker.replies?.findIndex(r => r.id === replyId);
    if (replyIndex === -1 || replyIndex === undefined) return false;

    const reply = marker.replies[replyIndex];

    // 권한 체크
    const authManager = getAuthManager();
    if (authManager.isAuthenticated && !authManager.canEditComment(reply)) {
      log.warn('권한 없음: 본인 답글만 삭제할 수 있습니다', { markerId, replyId, author: reply.author });
      this._emit('permissionDenied', { action: 'deleteReply', reply });
      return false;
    }

    marker.replies.splice(replyIndex, 1);
    marker.updatedAt = new Date();

    this._emit('replyDeleted', { marker, replyId });
    this._emit('markersChanged');
    return true;
  }

  /**
   * 코멘트/답글 수정/삭제 가능 여부 확인 (UI 표시용)
   * @param {{ author: string }} item - 코멘트 또는 답글
   * @returns {boolean}
   */
  canEdit(item) {
    const authManager = getAuthManager();
    if (!authManager.isAuthenticated) return true; // 인증 미사용 시 모두 허용
    return authManager.canEditComment(item);
  }

  /**
   * ID로 마커 가져오기
   */
  getMarker(markerId) {
    for (const layer of this.layers) {
      const marker = layer.getMarker(markerId);
      if (marker) return marker;
    }
    return null;
  }

  /**
   * 현재 프레임의 모든 마커 가져오기
   */
  getMarkersAtCurrentFrame() {
    const markers = [];
    for (const layer of this.layers) {
      if (layer.visible) {
        markers.push(...layer.getMarkersAtFrame(this.currentFrame));
      }
    }
    return markers;
  }

  /**
   * 모든 마커 가져오기
   */
  getAllMarkers() {
    const markers = [];
    for (const layer of this.layers) {
      markers.push(...layer.getAllMarkers());
    }
    return markers.sort((a, b) => a.startFrame - b.startFrame);
  }

  /**
   * 현재 프레임 기준 이전 마커의 시작 프레임 찾기
   * @param {number} currentFrame - 현재 프레임
   * @returns {number|null} 이전 마커의 시작 프레임 또는 null
   */
  getPrevMarkerFrame(currentFrame) {
    const markers = this.getAllMarkers();
    // 현재 프레임보다 시작 프레임이 작은 마커들 중 가장 큰 것
    let prevMarker = null;
    for (const marker of markers) {
      if (marker.startFrame < currentFrame) {
        if (!prevMarker || marker.startFrame > prevMarker.startFrame) {
          prevMarker = marker;
        }
      }
    }
    return prevMarker ? prevMarker.startFrame : null;
  }

  /**
   * 현재 프레임 기준 다음 마커의 시작 프레임 찾기
   * @param {number} currentFrame - 현재 프레임
   * @returns {number|null} 다음 마커의 시작 프레임 또는 null
   */
  getNextMarkerFrame(currentFrame) {
    const markers = this.getAllMarkers();
    // 현재 프레임보다 시작 프레임이 큰 마커들 중 가장 작은 것
    let nextMarker = null;
    for (const marker of markers) {
      if (marker.startFrame > currentFrame) {
        if (!nextMarker || marker.startFrame < nextMarker.startFrame) {
          nextMarker = marker;
        }
      }
    }
    return nextMarker ? nextMarker.startFrame : null;
  }

  /**
   * 활성 레이어 가져오기
   */
  getActiveLayer() {
    return this.layers.find(l => l.id === this.activeLayerId);
  }

  /**
   * 레이어 추가
   */
  addLayer(name) {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9'];
    const layer = new CommentLayer({
      name: name || `댓글 ${this.layers.length + 1}`,
      color: colors[this.layers.length % colors.length]
    });
    this.layers.push(layer);
    this._emit('layersChanged');
    return layer;
  }

  /**
   * 레이어 삭제
   */
  deleteLayer(layerId) {
    if (this.layers.length <= 1) return false;

    const index = this.layers.findIndex(l => l.id === layerId);
    if (index === -1) return false;

    this.layers.splice(index, 1);

    // 활성 레이어가 삭제되면 첫 번째 레이어로 변경
    if (this.activeLayerId === layerId) {
      this.activeLayerId = this.layers[0].id;
    }

    this._emit('layersChanged');
    this._emit('markersChanged');
    return true;
  }

  /**
   * 활성 레이어 설정
   */
  setActiveLayer(layerId) {
    const layer = this.layers.find(l => l.id === layerId);
    if (layer) {
      this.activeLayerId = layerId;
      this._emit('activeLayerChanged', { layerId });
    }
  }

  /**
   * 마커 가시성 업데이트
   */
  _updateMarkersVisibility() {
    this._emit('frameChanged', {
      frame: this.currentFrame,
      visibleMarkers: this.getMarkersAtCurrentFrame()
    });
  }

  /**
   * 타임라인용 마커 범위 가져오기
   */
  getMarkerRanges(layerId = null) {
    const ranges = [];
    const layersToCheck = layerId
      ? [this.layers.find(l => l.id === layerId)]
      : this.layers;

    for (const layer of layersToCheck) {
      if (!layer) continue;
      for (const marker of layer.getAllMarkers()) {
        // 마커 개별 색상 사용 (없으면 레이어 색상)
        const markerColor = marker.colorInfo?.color || layer.color;
        ranges.push({
          layerId: layer.id,
          markerId: marker.id,
          startFrame: marker.startFrame,
          endFrame: marker.endFrame,
          color: markerColor,
          colorKey: marker.colorKey || 'default',
          text: marker.text,
          resolved: marker.resolved
        });
      }
    }

    return ranges;
  }

  /**
   * 커스텀 이벤트 발생
   */
  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  /**
   * JSON으로 내보내기
   */
  toJSON() {
    return {
      fps: this.fps,
      layers: this.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        color: layer.color,
        visible: layer.visible,
        locked: layer.locked,
        // 삭제된 마커도 포함 (협업 동기화용)
        markers: layer.getAllMarkers(true).map(m => m.toJSON())
      }))
    };
  }

  /**
   * JSON에서 불러오기
   */
  fromJSON(json) {
    this.layers = [];

    if (json.fps) {
      this.fps = json.fps;
    }

    if (json.layers && Array.isArray(json.layers)) {
      for (const layerData of json.layers) {
        const layer = new CommentLayer({
          id: layerData.id,
          name: layerData.name,
          color: layerData.color,
          visible: layerData.visible,
          locked: layerData.locked
        });

        if (layerData.markers) {
          for (const markerData of layerData.markers) {
            layer.addMarker(CommentMarker.fromJSON(markerData));
          }
        }

        this.layers.push(layer);
      }

      if (this.layers.length > 0) {
        this.activeLayerId = this.layers[0].id;
      }
    }

    if (this.layers.length === 0) {
      this._createDefaultLayer();
    }

    this._emit('markersChanged');
    this._emit('layersChanged');
  }

  /**
   * 모든 마커/레이어 초기화 (새 파일 로드 시)
   */
  clear() {
    this.layers = [];
    this.pendingMarker = null;
    this.pendingText = null;
    this.isCommentMode = false;
    this._createDefaultLayer();
    this._emit('markersChanged');
    this._emit('layersChanged');
    log.info('CommentManager 초기화됨');
  }

  /**
   * 정리
   */
  destroy() {
    this.layers = [];
    this.pendingMarker = null;
    log.info('CommentManager 정리됨');
  }
}

export default CommentManager;
