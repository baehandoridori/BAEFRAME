/**
 * baeframe - Image Utilities Module
 * 이미지 압축, 리사이즈, Base64 변환 유틸리티
 */

import { createLogger } from '../logger.js';

const log = createLogger('ImageUtils');

/**
 * 이미지 압축 설정
 */
export const IMAGE_CONFIG = {
  maxWidth: 1920,
  maxHeight: 1080,
  quality: 0.85,      // JPEG 품질 (0.0 ~ 1.0)
  maxFileSize: 500 * 1024,  // 최대 500KB
  thumbnailSize: 120,  // 썸네일 크기
  format: 'image/jpeg'
};

/**
 * 파일/Blob을 Image 객체로 로드
 */
function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('이미지 로드 실패'));

    if (source instanceof Blob || source instanceof File) {
      img.src = URL.createObjectURL(source);
    } else if (typeof source === 'string') {
      img.src = source;
    } else {
      reject(new Error('지원하지 않는 이미지 소스'));
    }
  });
}

/**
 * 이미지를 Canvas에 리사이즈하여 그리기
 */
function resizeImageToCanvas(img, maxWidth, maxHeight) {
  let { width, height } = img;

  // 비율 유지하며 최대 크기에 맞춤
  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  return canvas;
}

/**
 * Canvas를 Base64로 변환 (품질 조절로 용량 제한)
 */
function canvasToBase64(canvas, format, targetQuality, maxSize) {
  let quality = targetQuality;
  let base64 = canvas.toDataURL(format, quality);

  // 용량 초과 시 품질 낮춰서 재시도
  while (base64.length > maxSize * 1.37 && quality > 0.3) { // Base64는 ~37% 증가
    quality -= 0.1;
    base64 = canvas.toDataURL(format, quality);
    log.debug('품질 조정', { quality: quality.toFixed(2), size: Math.round(base64.length / 1024) + 'KB' });
  }

  return { base64, quality };
}

/**
 * 이미지 압축 및 Base64 변환
 * @param {File|Blob|string} source - 이미지 소스 (파일, Blob, URL, 또는 data URL)
 * @param {Object} options - 압축 옵션
 * @returns {Promise<{base64: string, width: number, height: number, size: number}>}
 */
export async function compressImage(source, options = {}) {
  const config = { ...IMAGE_CONFIG, ...options };

  try {
    const img = await loadImage(source);

    log.info('이미지 압축 시작', {
      originalWidth: img.width,
      originalHeight: img.height
    });

    // 리사이즈
    const canvas = resizeImageToCanvas(img, config.maxWidth, config.maxHeight);

    // Base64 변환 (용량 제한)
    const { base64, quality } = canvasToBase64(
      canvas,
      config.format,
      config.quality,
      config.maxFileSize
    );

    // ObjectURL 해제
    if (source instanceof Blob || source instanceof File) {
      URL.revokeObjectURL(img.src);
    }

    const result = {
      base64,
      width: canvas.width,
      height: canvas.height,
      size: Math.round(base64.length * 0.73), // 실제 바이트 크기 근사값
      quality
    };

    log.info('이미지 압축 완료', {
      width: result.width,
      height: result.height,
      size: Math.round(result.size / 1024) + 'KB',
      quality: quality.toFixed(2)
    });

    return result;
  } catch (error) {
    log.error('이미지 압축 실패', { error: error.message });
    throw error;
  }
}

/**
 * 썸네일 생성
 * @param {string} base64 - 원본 Base64 이미지
 * @param {number} size - 썸네일 크기 (정사각형)
 * @returns {Promise<string>} 썸네일 Base64
 */
export async function createThumbnail(base64, size = IMAGE_CONFIG.thumbnailSize) {
  try {
    const img = await loadImage(base64);

    // 정사각형 크롭 (중앙 기준)
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 중앙 크롭 계산
    const sourceSize = Math.min(img.width, img.height);
    const sx = (img.width - sourceSize) / 2;
    const sy = (img.height - sourceSize) / 2;

    ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, size, size);

    return canvas.toDataURL('image/jpeg', 0.7);
  } catch (error) {
    log.error('썸네일 생성 실패', { error: error.message });
    throw error;
  }
}

/**
 * 클립보드에서 이미지 가져오기
 * @param {ClipboardEvent} event - 붙여넣기 이벤트
 * @returns {Promise<{base64: string, width: number, height: number}|null>}
 */
export async function getImageFromClipboard(event) {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      if (blob) {
        return await compressImage(blob);
      }
    }
  }

  return null;
}

/**
 * 파일 선택으로 이미지 가져오기
 * @returns {Promise<{base64: string, width: number, height: number}|null>}
 */
export function selectImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        try {
          const result = await compressImage(file);
          resolve(result);
        } catch (error) {
          log.error('파일 이미지 처리 실패', { error: error.message });
          resolve(null);
        }
      } else {
        resolve(null);
      }
    };

    input.click();
  });
}

/**
 * 드래그 앤 드롭으로 이미지 가져오기
 * @param {DragEvent} event - 드롭 이벤트
 * @returns {Promise<{base64: string, width: number, height: number}|null>}
 */
export async function getImageFromDrop(event) {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return null;

  const file = files[0];
  if (!file.type.startsWith('image/')) return null;

  return await compressImage(file);
}

/**
 * Base64 이미지 크기 계산 (바이트)
 */
export function getBase64Size(base64) {
  // data:image/jpeg;base64, 부분 제거 후 계산
  const base64Data = base64.split(',')[1] || base64;
  return Math.round(base64Data.length * 0.75);
}

/**
 * 이미지 유효성 검사
 */
export function isValidImageBase64(base64) {
  return typeof base64 === 'string' &&
         base64.startsWith('data:image/') &&
         base64.includes('base64,');
}

export default {
  compressImage,
  createThumbnail,
  getImageFromClipboard,
  selectImageFile,
  getImageFromDrop,
  getBase64Size,
  isValidImageBase64,
  IMAGE_CONFIG
};
