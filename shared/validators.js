/**
 * 데이터 검증 유틸리티
 */

/**
 * 리뷰 데이터 스키마 검증
 * @param {Object} data - 검증할 리뷰 데이터
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateReviewData(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['데이터가 객체가 아닙니다.'] };
  }

  // 필수 필드 검증
  if (!data.version) errors.push('version 필드가 없습니다.');
  if (!data.videoFile) errors.push('videoFile 필드가 없습니다.');
  if (typeof data.fps !== 'number') errors.push('fps는 숫자여야 합니다.');
  if (!Array.isArray(data.comments)) errors.push('comments는 배열이어야 합니다.');

  // 댓글 검증
  if (Array.isArray(data.comments)) {
    data.comments.forEach((comment, index) => {
      const commentErrors = validateComment(comment);
      if (commentErrors.length > 0) {
        errors.push(`comments[${index}]: ${commentErrors.join(', ')}`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 댓글 데이터 검증
 * @param {Object} comment - 검증할 댓글 데이터
 * @returns {string[]} 에러 목록
 */
export function validateComment(comment) {
  const errors = [];

  if (!comment.id) errors.push('id 필드가 없습니다.');
  if (typeof comment.frame !== 'number') errors.push('frame은 숫자여야 합니다.');
  if (!comment.author) errors.push('author 필드가 없습니다.');
  if (!comment.content && (!comment.drawings || comment.drawings.length === 0)) {
    errors.push('content 또는 drawings가 필요합니다.');
  }

  // 드로잉 검증
  if (Array.isArray(comment.drawings)) {
    comment.drawings.forEach((drawing, index) => {
      const drawingErrors = validateDrawing(drawing);
      if (drawingErrors.length > 0) {
        errors.push(`drawings[${index}]: ${drawingErrors.join(', ')}`);
      }
    });
  }

  return errors;
}

/**
 * 드로잉 데이터 검증
 * @param {Object} drawing - 검증할 드로잉 데이터
 * @returns {string[]} 에러 목록
 */
export function validateDrawing(drawing) {
  const errors = [];

  if (!drawing.id) errors.push('id 필드가 없습니다.');
  if (!drawing.type) errors.push('type 필드가 없습니다.');
  if (!drawing.color) errors.push('color 필드가 없습니다.');

  const validTypes = ['arrow', 'stroke', 'circle', 'rectangle'];
  if (drawing.type && !validTypes.includes(drawing.type)) {
    errors.push(`유효하지 않은 type: ${drawing.type}`);
  }

  // 타입별 필수 필드 검증
  if (drawing.type === 'arrow') {
    if (typeof drawing.startX !== 'number') errors.push('startX는 숫자여야 합니다.');
    if (typeof drawing.startY !== 'number') errors.push('startY는 숫자여야 합니다.');
    if (typeof drawing.endX !== 'number') errors.push('endX는 숫자여야 합니다.');
    if (typeof drawing.endY !== 'number') errors.push('endY는 숫자여야 합니다.');
  }

  if (drawing.type === 'stroke') {
    if (!Array.isArray(drawing.points)) errors.push('points는 배열이어야 합니다.');
  }

  return errors;
}

/**
 * 파일 경로가 지원되는 비디오 형식인지 확인
 * @param {string} filePath - 파일 경로
 * @returns {boolean}
 */
export function isValidVideoFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;

  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  const supportedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

  return supportedExtensions.includes(ext);
}

/**
 * 좌표가 유효한 범위인지 확인 (0~1)
 * @param {number} value - 좌표 값
 * @returns {boolean}
 */
export function isValidCoordinate(value) {
  return typeof value === 'number' && value >= 0 && value <= 1;
}
