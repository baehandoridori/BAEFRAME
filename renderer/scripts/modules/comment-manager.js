/**
 * baeframe - Comment Manager Module
 * 댓글 시스템 관리
 */

import { createLogger } from '../logger.js';

const log = createLogger('CommentManager');

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
 * 댓글 클래스
 */
export class Comment {
  constructor(options = {}) {
    this.id = options.id || generateUUID();
    this.frame = options.frame || 0;
    this.timecode = options.timecode || frameToTimecode(this.frame, options.fps || 24);
    this.text = options.text || '';
    this.author = options.author || '익명';
    this.createdAt = options.createdAt || new Date();
    this.resolved = options.resolved || false;
    this.hasDrawing = options.hasDrawing || false;
    this.drawingSnapshot = options.drawingSnapshot || null;
  }

  /**
   * 댓글 해결 상태 토글
   */
  toggleResolved() {
    this.resolved = !this.resolved;
    return this.resolved;
  }

  /**
   * JSON으로 변환 (저장용)
   */
  toJSON() {
    return {
      id: this.id,
      frame: this.frame,
      timecode: this.timecode,
      text: this.text,
      author: this.author,
      createdAt: this.createdAt instanceof Date ? this.createdAt.toISOString() : this.createdAt,
      resolved: this.resolved,
      hasDrawing: this.hasDrawing,
      drawingSnapshot: this.drawingSnapshot
    };
  }

  /**
   * JSON에서 Comment 객체 생성
   */
  static fromJSON(json) {
    return new Comment({
      ...json,
      createdAt: new Date(json.createdAt)
    });
  }
}

/**
 * 댓글 관리자 클래스
 */
export class CommentManager extends EventTarget {
  constructor(options = {}) {
    super();

    this.comments = new Map();
    this.fps = options.fps || 24;
    this.currentFilter = 'all'; // 'all', 'unresolved', 'resolved'

    log.info('CommentManager 초기화됨');
  }

  /**
   * FPS 설정
   */
  setFPS(fps) {
    this.fps = fps;
    log.debug('FPS 설정', { fps });
  }

  /**
   * 댓글 추가
   */
  addComment(options = {}) {
    const comment = new Comment({
      ...options,
      fps: this.fps
    });

    this.comments.set(comment.id, comment);

    log.info('댓글 추가됨', {
      id: comment.id,
      frame: comment.frame,
      text: comment.text.substring(0, 30)
    });

    this._emit('commentAdded', { comment });
    this._emit('commentsChanged', { comments: this.getAllComments() });

    return comment;
  }

  /**
   * 댓글 삭제
   */
  deleteComment(commentId) {
    const comment = this.comments.get(commentId);
    if (!comment) {
      log.warn('삭제할 댓글을 찾을 수 없음', { commentId });
      return false;
    }

    this.comments.delete(commentId);

    log.info('댓글 삭제됨', { id: commentId });

    this._emit('commentDeleted', { commentId, comment });
    this._emit('commentsChanged', { comments: this.getAllComments() });

    return true;
  }

  /**
   * 댓글 수정
   */
  updateComment(commentId, updates) {
    const comment = this.comments.get(commentId);
    if (!comment) {
      log.warn('수정할 댓글을 찾을 수 없음', { commentId });
      return null;
    }

    // 허용된 필드만 업데이트
    const allowedFields = ['text', 'author', 'resolved'];
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        comment[field] = updates[field];
      }
    });

    log.info('댓글 수정됨', { id: commentId });

    this._emit('commentUpdated', { comment });
    this._emit('commentsChanged', { comments: this.getAllComments() });

    return comment;
  }

  /**
   * 댓글 해결 상태 토글
   */
  toggleResolve(commentId) {
    const comment = this.comments.get(commentId);
    if (!comment) {
      log.warn('댓글을 찾을 수 없음', { commentId });
      return null;
    }

    comment.toggleResolved();

    log.info('댓글 해결 상태 변경', { id: commentId, resolved: comment.resolved });

    this._emit('commentResolved', { comment });
    this._emit('commentsChanged', { comments: this.getAllComments() });

    return comment;
  }

  /**
   * ID로 댓글 가져오기
   */
  getComment(commentId) {
    return this.comments.get(commentId);
  }

  /**
   * 특정 프레임의 댓글 가져오기
   */
  getCommentsAtFrame(frame) {
    return Array.from(this.comments.values())
      .filter(comment => comment.frame === frame)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  /**
   * 모든 댓글 가져오기
   */
  getAllComments() {
    return Array.from(this.comments.values())
      .sort((a, b) => a.frame - b.frame || new Date(a.createdAt) - new Date(b.createdAt));
  }

  /**
   * 필터링된 댓글 가져오기
   */
  getFilteredComments(filter = this.currentFilter) {
    const all = this.getAllComments();

    switch (filter) {
    case 'unresolved':
      return all.filter(c => !c.resolved);
    case 'resolved':
      return all.filter(c => c.resolved);
    default:
      return all;
    }
  }

  /**
   * 필터 설정
   */
  setFilter(filter) {
    this.currentFilter = filter;
    log.debug('필터 변경', { filter });

    this._emit('filterChanged', {
      filter,
      comments: this.getFilteredComments()
    });
  }

  /**
   * 댓글 개수 가져오기
   */
  getCommentCount() {
    const all = this.getAllComments();
    return {
      total: all.length,
      unresolved: all.filter(c => !c.resolved).length,
      resolved: all.filter(c => c.resolved).length
    };
  }

  /**
   * 댓글이 있는 프레임 목록 가져오기 (타임라인 마커용)
   */
  getCommentFrames() {
    const frames = new Map();

    this.comments.forEach(comment => {
      if (!frames.has(comment.frame)) {
        frames.set(comment.frame, {
          frame: comment.frame,
          hasUnresolved: false,
          count: 0
        });
      }

      const frameInfo = frames.get(comment.frame);
      frameInfo.count++;
      if (!comment.resolved) {
        frameInfo.hasUnresolved = true;
      }
    });

    return Array.from(frames.values());
  }

  /**
   * 모든 댓글 초기화
   */
  clearAll() {
    this.comments.clear();
    log.info('모든 댓글 삭제됨');

    this._emit('commentsCleared');
    this._emit('commentsChanged', { comments: [] });
  }

  /**
   * JSON으로 내보내기 (저장용)
   */
  toJSON() {
    return {
      fps: this.fps,
      comments: this.getAllComments().map(c => c.toJSON())
    };
  }

  /**
   * JSON에서 불러오기
   */
  fromJSON(json) {
    this.clearAll();

    if (json.fps) {
      this.fps = json.fps;
    }

    if (json.comments && Array.isArray(json.comments)) {
      json.comments.forEach(commentData => {
        const comment = Comment.fromJSON(commentData);
        this.comments.set(comment.id, comment);
      });
    }

    log.info('댓글 데이터 로드됨', { count: this.comments.size });

    this._emit('commentsLoaded', { comments: this.getAllComments() });
    this._emit('commentsChanged', { comments: this.getAllComments() });
  }

  /**
   * 커스텀 이벤트 발생
   */
  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  /**
   * 정리
   */
  destroy() {
    this.comments.clear();
    log.info('CommentManager 정리됨');
  }
}

export default CommentManager;
