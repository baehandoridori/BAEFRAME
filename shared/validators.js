/**
 * 데이터 검증 유틸리티
 * v2.0 스키마 기준
 */

import {
  SUPPORTED_VERSIONS,
  isValidVideoFile,
  isValidCoordinate
} from './schema.js';
import { isValidReviewDocumentId } from './bframe-root-envelope.js';

// re-export for backward compatibility
export { isValidVideoFile, isValidCoordinate };

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * 리뷰 데이터 스키마 검증 (v2.0)
 * @param {Object} data - 검증할 리뷰 데이터
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateReviewData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['데이터가 객체가 아닙니다.'], warnings: [] };
  }

  // 버전 필드 검증
  const version = data.bframeVersion || data.version;
  if (!version) {
    warnings.push('버전 필드가 없습니다. 레거시 데이터일 수 있습니다.');
  } else if (!SUPPORTED_VERSIONS.includes(version)) {
    warnings.push(`알 수 없는 버전: ${version}`);
  }

  // 리뷰 문서 ID는 선택 필드지만, 존재하면 계보 식별 형식을 지켜야 한다.
  if (
    Object.hasOwn(data, 'reviewDocumentId') &&
    !isValidReviewDocumentId(data.reviewDocumentId)
  ) {
    errors.push('reviewDocumentId는 reviewdoc-<UUID> 형식의 문자열이어야 합니다.');
  }

  // 비디오 파일 검증
  if (!data.videoFile && !data.videoPath) {
    errors.push('videoFile 또는 videoPath 필드가 필요합니다.');
  }

  // fps 검증 (선택적이지만 있다면 숫자여야 함)
  if (data.fps !== undefined && typeof data.fps !== 'number') {
    errors.push('fps는 숫자여야 합니다.');
  }

  // 댓글 구조 검증
  if (data.comments) {
    const commentErrors = validateComments(data.comments);
    errors.push(...commentErrors);
  }

  // 그리기 구조 검증
  if (data.drawings) {
    const drawingErrors = validateDrawings(data.drawings);
    errors.push(...drawingErrors);
  }

  // 하이라이트 검증
  if (data.highlights && !Array.isArray(data.highlights)) {
    errors.push('highlights는 배열이어야 합니다.');
  }

  // 레이어 합성 검증 (선택적)
  if (data.compositionLayers) {
    const compositionErrors = validateCompositionLayers(data.compositionLayers);
    errors.push(...compositionErrors);
  }

  // 버전 정보 검증 (선택적)
  if (data.versionInfo && typeof data.versionInfo !== 'object') {
    errors.push('versionInfo는 객체여야 합니다.');
  }

  // 수동 버전 목록 검증 (선택적)
  if (data.manualVersions && !Array.isArray(data.manualVersions)) {
    errors.push('manualVersions는 배열이어야 합니다.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * 댓글 데이터 구조 검증
 * @param {Object|Array} comments - 검증할 댓글 데이터
 * @returns {string[]} 에러 목록
 */
export function validateComments(comments) {
  const errors = [];

  // v2.0 형식: { layers: [...] }
  if (comments && typeof comments === 'object' && !Array.isArray(comments)) {
    if (!Array.isArray(comments.layers)) {
      errors.push('comments.layers는 배열이어야 합니다.');
      return errors;
    }

    comments.layers.forEach((layer, layerIndex) => {
      const layerErrors = validateCommentLayer(layer, layerIndex);
      errors.push(...layerErrors);
    });
  }
  // 레거시 형식: 배열
  else if (Array.isArray(comments)) {
    comments.forEach((comment, index) => {
      const commentErrors = validateCommentMarker(comment);
      if (commentErrors.length > 0) {
        errors.push(`comments[${index}]: ${commentErrors.join(', ')}`);
      }
    });
  }

  return errors;
}

/**
 * 댓글 레이어 검증
 * @param {Object} layer - 검증할 레이어 데이터
 * @param {number} layerIndex - 레이어 인덱스
 * @returns {string[]} 에러 목록
 */
export function validateCommentLayer(layer, layerIndex) {
  const errors = [];
  const prefix = `comments.layers[${layerIndex}]`;

  if (!layer.id) {
    errors.push(`${prefix}: id 필드가 없습니다.`);
  }

  if (!layer.name) {
    errors.push(`${prefix}: name 필드가 없습니다.`);
  }

  if (!Array.isArray(layer.markers)) {
    errors.push(`${prefix}: markers는 배열이어야 합니다.`);
  } else {
    layer.markers.forEach((marker, markerIndex) => {
      const markerErrors = validateCommentMarker(marker);
      if (markerErrors.length > 0) {
        errors.push(`${prefix}.markers[${markerIndex}]: ${markerErrors.join(', ')}`);
      }
    });
  }

  return errors;
}

/**
 * 댓글 마커 검증
 * @param {Object} marker - 검증할 마커 데이터
 * @returns {string[]} 에러 목록
 */
export function validateCommentMarker(marker) {
  const errors = [];

  if (!marker.id) errors.push('id 필드가 없습니다.');
  if (typeof marker.frame !== 'number') errors.push('frame은 숫자여야 합니다.');

  // author는 선택적 (익명 가능)
  // content 또는 drawings 중 하나는 있어야 함
  if (!marker.content && (!marker.drawings || marker.drawings.length === 0)) {
    errors.push('content 또는 drawings가 필요합니다.');
  }

  // 드로잉 검증
  if (Array.isArray(marker.drawings)) {
    marker.drawings.forEach((drawing, index) => {
      const drawingErrors = validateDrawingObject(drawing);
      if (drawingErrors.length > 0) {
        errors.push(`drawings[${index}]: ${drawingErrors.join(', ')}`);
      }
    });
  }

  return errors;
}

/**
 * 그리기 데이터 구조 검증
 * @param {Object} drawings - 검증할 그리기 데이터
 * @returns {string[]} 에러 목록
 */
export function validateDrawings(drawings) {
  const errors = [];

  // v2.0 형식: { layers: [...] }
  if (drawings && typeof drawings === 'object') {
    if (!Array.isArray(drawings.layers)) {
      errors.push('drawings.layers는 배열이어야 합니다.');
      return errors;
    }

    drawings.layers.forEach((layer, layerIndex) => {
      const layerErrors = validateDrawingLayer(layer, layerIndex);
      errors.push(...layerErrors);
    });
  }

  return errors;
}

/**
 * 그리기 레이어 검증
 * @param {Object} layer - 검증할 레이어 데이터
 * @param {number} layerIndex - 레이어 인덱스
 * @returns {string[]} 에러 목록
 */
export function validateDrawingLayer(layer, layerIndex) {
  const errors = [];
  const prefix = `drawings.layers[${layerIndex}]`;

  if (!layer.id) {
    errors.push(`${prefix}: id 필드가 없습니다.`);
  }

  if (!layer.name) {
    errors.push(`${prefix}: name 필드가 없습니다.`);
  }

  if (!Array.isArray(layer.keyframes)) {
    errors.push(`${prefix}: keyframes는 배열이어야 합니다.`);
  } else {
    layer.keyframes.forEach((keyframe, kfIndex) => {
      if (typeof keyframe.frame !== 'number') {
        errors.push(`${prefix}.keyframes[${kfIndex}]: frame은 숫자여야 합니다.`);
      }

      if (Array.isArray(keyframe.objects)) {
        keyframe.objects.forEach((obj, objIndex) => {
          const objErrors = validateDrawingObject(obj);
          if (objErrors.length > 0) {
            errors.push(
              `${prefix}.keyframes[${kfIndex}].objects[${objIndex}]: ${objErrors.join(', ')}`
            );
          }
        });
      }
    });
  }

  return errors;
}

/**
 * 드로잉 객체 검증
 * @param {Object} drawing - 검증할 드로잉 데이터
 * @returns {string[]} 에러 목록
 */
export function validateDrawingObject(drawing) {
  const errors = [];

  if (!drawing.id) errors.push('id 필드가 없습니다.');
  if (!drawing.type) errors.push('type 필드가 없습니다.');
  if (!drawing.color) errors.push('color 필드가 없습니다.');

  const validTypes = ['arrow', 'stroke', 'circle', 'rectangle', 'freehand', 'line'];
  if (drawing.type && !validTypes.includes(drawing.type)) {
    errors.push(`유효하지 않은 type: ${drawing.type}`);
  }

  // 타입별 필수 필드 검증
  if (drawing.type === 'arrow' || drawing.type === 'line') {
    if (!isValidCoordinate(drawing.startX)) errors.push('startX는 0~1 범위여야 합니다.');
    if (!isValidCoordinate(drawing.startY)) errors.push('startY는 0~1 범위여야 합니다.');
    if (!isValidCoordinate(drawing.endX)) errors.push('endX는 0~1 범위여야 합니다.');
    if (!isValidCoordinate(drawing.endY)) errors.push('endY는 0~1 범위여야 합니다.');
  }

  if (drawing.type === 'stroke' || drawing.type === 'freehand') {
    if (!Array.isArray(drawing.points)) errors.push('points는 배열이어야 합니다.');
  }

  if (drawing.type === 'circle' || drawing.type === 'rectangle') {
    if (!isValidCoordinate(drawing.x)) errors.push('x는 0~1 범위여야 합니다.');
    if (!isValidCoordinate(drawing.y)) errors.push('y는 0~1 범위여야 합니다.');
    if (drawing.width !== undefined && typeof drawing.width !== 'number') {
      errors.push('width는 숫자여야 합니다.');
    }
    if (drawing.height !== undefined && typeof drawing.height !== 'number') {
      errors.push('height는 숫자여야 합니다.');
    }
  }

  return errors;
}

/**
 * 레이어 합성 데이터 검증
 * @param {Array} layers - 검증할 합성 레이어 목록
 * @returns {string[]} 에러 목록
 */
export function validateCompositionLayers(layers) {
  const errors = [];

  if (!Array.isArray(layers)) {
    return ['compositionLayers는 배열이어야 합니다.'];
  }

  layers.forEach((layer, index) => {
    const layerErrors = validateCompositionLayer(layer, index);
    errors.push(...layerErrors);
  });

  return errors;
}

/**
 * 합성 레이어 검증
 * @param {Object} layer - 검증할 합성 레이어
 * @param {number} index - 레이어 인덱스
 * @returns {string[]} 에러 목록
 */
export function validateCompositionLayer(layer, index) {
  const errors = [];
  const prefix = `compositionLayers[${index}]`;

  if (!layer || typeof layer !== 'object') {
    return [`${prefix}: 객체여야 합니다.`];
  }

  if (!layer.id) errors.push(`${prefix}: id 필드가 없습니다.`);
  if (!layer.name) errors.push(`${prefix}: name 필드가 없습니다.`);
  if (!['image', 'video'].includes(layer.type)) {
    errors.push(`${prefix}: type은 image 또는 video여야 합니다.`);
  }
  if (!layer.filePath && !layer.sourceDataUrl) {
    errors.push(`${prefix}: filePath 또는 sourceDataUrl 중 하나가 필요합니다.`);
  }
  if (
    layer.sourceDataUrl !== undefined &&
    layer.sourceDataUrl !== '' &&
    (typeof layer.sourceDataUrl !== 'string' || !layer.sourceDataUrl.startsWith('data:image/'))
  ) {
    errors.push(`${prefix}: sourceDataUrl은 data:image/ 형식의 데이터 URL이어야 합니다.`);
  }
  if (typeof layer.enabled !== 'boolean') errors.push(`${prefix}: enabled는 boolean이어야 합니다.`);
  if (!Number.isFinite(layer.order)) errors.push(`${prefix}: order는 숫자여야 합니다.`);
  if (!Number.isFinite(layer.startTime) || layer.startTime < 0) {
    errors.push(`${prefix}: startTime은 0 이상의 숫자여야 합니다.`);
  }
  if (!Number.isFinite(layer.endTime) || layer.endTime <= layer.startTime) {
    errors.push(`${prefix}: endTime은 startTime보다 큰 숫자여야 합니다.`);
  }
  if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
    errors.push(`${prefix}: opacity는 0~1 범위여야 합니다.`);
  }
  if (!Number.isFinite(layer.x)) errors.push(`${prefix}: x는 숫자여야 합니다.`);
  if (!Number.isFinite(layer.y)) errors.push(`${prefix}: y는 숫자여야 합니다.`);
  if (!Number.isFinite(layer.width) || layer.width <= 0) {
    errors.push(`${prefix}: width는 0보다 큰 숫자여야 합니다.`);
  }
  if (!Number.isFinite(layer.height) || layer.height <= 0) {
    errors.push(`${prefix}: height는 0보다 큰 숫자여야 합니다.`);
  }
  if (layer.aspectLocked !== undefined && typeof layer.aspectLocked !== 'boolean') {
    errors.push(`${prefix}: aspectLocked는 boolean이어야 합니다.`);
  }
  if (layer.color !== undefined && !HEX_COLOR_PATTERN.test(layer.color)) {
    errors.push(`${prefix}: color는 HEX 색상이어야 합니다.`);
  }
  if (layer.selectedColor !== undefined && !HEX_COLOR_PATTERN.test(layer.selectedColor)) {
    errors.push(`${prefix}: selectedColor는 HEX 색상이어야 합니다.`);
  }
  if (
    layer.sourceDuration !== null &&
    layer.sourceDuration !== undefined &&
    (!Number.isFinite(layer.sourceDuration) || layer.sourceDuration < 0)
  ) {
    errors.push(`${prefix}: sourceDuration은 null 또는 0 이상의 숫자여야 합니다.`);
  }

  return errors;
}

/**
 * 버전 정보 검증
 * @param {Object} versionInfo - 검증할 버전 정보
 * @returns {string[]} 에러 목록
 */
export function validateVersionInfo(versionInfo) {
  const errors = [];

  if (!versionInfo || typeof versionInfo !== 'object') {
    return ['versionInfo는 객체여야 합니다.'];
  }

  // detectedVersion은 null이거나 숫자
  if (
    versionInfo.detectedVersion !== null &&
    typeof versionInfo.detectedVersion !== 'number'
  ) {
    errors.push('detectedVersion은 null 또는 숫자여야 합니다.');
  }

  // baseName은 필수
  if (!versionInfo.baseName) {
    errors.push('baseName 필드가 필요합니다.');
  }

  return errors;
}

/**
 * 수동 버전 검증
 * @param {Object} manualVersion - 검증할 수동 버전 데이터
 * @returns {string[]} 에러 목록
 */
export function validateManualVersion(manualVersion) {
  const errors = [];

  if (!manualVersion || typeof manualVersion !== 'object') {
    return ['manualVersion은 객체여야 합니다.'];
  }

  if (typeof manualVersion.version !== 'number') {
    errors.push('version은 숫자여야 합니다.');
  }

  if (!manualVersion.fileName) {
    errors.push('fileName 필드가 필요합니다.');
  }

  if (!manualVersion.filePath) {
    errors.push('filePath 필드가 필요합니다.');
  }

  return errors;
}

// 이전 버전 호환성을 위한 alias
export const validateComment = validateCommentMarker;
export const validateDrawing = validateDrawingObject;

export default {
  validateReviewData,
  validateComments,
  validateCommentLayer,
  validateCommentMarker,
  validateDrawings,
  validateDrawingLayer,
  validateDrawingObject,
  validateCompositionLayers,
  validateCompositionLayer,
  validateVersionInfo,
  validateManualVersion,
  isValidVideoFile,
  isValidCoordinate
};
