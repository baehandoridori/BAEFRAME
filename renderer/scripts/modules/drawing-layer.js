/**
 * baeframe - Drawing Layer Module
 * 그리기 레이어와 키프레임 데이터 모델
 */

import { createLogger } from '../logger.js';

const log = createLogger('DrawingLayer');

/**
 * 키프레임 클래스
 * Adobe Animate의 키프레임과 유사
 */
export class Keyframe {
  constructor(frame, canvasData = null) {
    this.frame = frame;           // 시작 프레임 번호
    this.canvasData = canvasData; // ImageData 또는 base64 문자열
    this.isEmpty = !canvasData;   // 빈 키프레임 여부
  }

  /**
   * 캔버스 데이터 설정
   */
  setCanvasData(data) {
    this.canvasData = data;
    this.isEmpty = !data;
  }

  /**
   * 키프레임 복제
   */
  clone() {
    return new Keyframe(this.frame, this.canvasData);
  }

  /**
   * JSON 직렬화
   */
  toJSON() {
    return {
      frame: this.frame,
      canvasData: this.canvasData,
      isEmpty: this.isEmpty
    };
  }

  /**
   * JSON에서 복원
   */
  static fromJSON(json) {
    const kf = new Keyframe(json.frame, json.canvasData);
    kf.isEmpty = json.isEmpty;
    return kf;
  }
}

/**
 * 드로잉 레이어 클래스
 */
export class DrawingLayer {
  static nextId = 1;

  constructor(options = {}) {
    this.id = options.id || `layer-${DrawingLayer.nextId++}`;
    this.name = options.name || `드로잉 ${DrawingLayer.nextId - 1}`;
    this.visible = options.visible !== false;
    this.locked = options.locked || false;
    this.color = options.color || this._generateColor();
    this.opacity = options.opacity || 1;

    // 키프레임 배열 (프레임 번호 순으로 정렬 유지)
    this.keyframes = [];

    log.debug('레이어 생성됨', { id: this.id, name: this.name });
  }

  /**
   * 레이어 색상 자동 생성
   */
  _generateColor() {
    const colors = [
      '#ff4757', '#ff6b81', '#ffa502', '#ffdd59',
      '#2ed573', '#7bed9f', '#1e90ff', '#70a1ff',
      '#5352ed', '#a55eea', '#ff6348', '#eccc68'
    ];
    return colors[DrawingLayer.nextId % colors.length];
  }

  /**
   * 키프레임 추가 또는 가져오기
   * @param {number} frame - 프레임 번호
   * @param {boolean} createIfNotExists - 없으면 생성할지 여부
   * @returns {Keyframe|null}
   */
  getOrCreateKeyframe(frame, createIfNotExists = true) {
    // 정확히 해당 프레임의 키프레임이 있는지 확인
    let keyframe = this.keyframes.find(kf => kf.frame === frame);

    if (!keyframe && createIfNotExists) {
      keyframe = new Keyframe(frame);
      this.keyframes.push(keyframe);
      this._sortKeyframes();
      log.debug('키프레임 생성됨', { layerId: this.id, frame });
    }

    return keyframe;
  }

  /**
   * 특정 프레임에서 보여야 할 키프레임 찾기
   * (해당 프레임 이하의 가장 가까운 키프레임)
   * @param {number} frame - 현재 프레임
   * @returns {Keyframe|null}
   */
  getKeyframeAtFrame(frame) {
    let result = null;

    for (const kf of this.keyframes) {
      if (kf.frame <= frame) {
        result = kf;
      } else {
        break; // 이미 정렬되어 있으므로 더 볼 필요 없음
      }
    }

    return result;
  }

  /**
   * 특정 프레임이 키프레임인지 확인
   */
  isKeyframe(frame) {
    return this.keyframes.some(kf => kf.frame === frame);
  }

  /**
   * 이전 키프레임 찾기
   * @param {number} currentFrame - 현재 프레임
   * @returns {number|null} 이전 키프레임의 프레임 번호 또는 null
   */
  getPrevKeyframeFrame(currentFrame) {
    let prevFrame = null;
    for (const kf of this.keyframes) {
      if (kf.frame < currentFrame) {
        prevFrame = kf.frame;
      } else {
        break;
      }
    }
    return prevFrame;
  }

  /**
   * 다음 키프레임 찾기
   * @param {number} currentFrame - 현재 프레임
   * @returns {number|null} 다음 키프레임의 프레임 번호 또는 null
   */
  getNextKeyframeFrame(currentFrame) {
    for (const kf of this.keyframes) {
      if (kf.frame > currentFrame) {
        return kf.frame;
      }
    }
    return null;
  }

  /**
   * 빈 키프레임 추가 (F7 기능)
   * @param {number} frame - 프레임 번호
   */
  addBlankKeyframe(frame) {
    // 기존 키프레임이 있으면 제거
    this.removeKeyframe(frame);

    const keyframe = new Keyframe(frame, null);
    this.keyframes.push(keyframe);
    this._sortKeyframes();

    log.debug('빈 키프레임 추가됨', { layerId: this.id, frame });
    return keyframe;
  }

  /**
   * 키프레임 복제 추가 (F6 기능)
   * @param {number} frame - 프레임 번호
   */
  addKeyframeWithContent(frame) {
    // 현재 프레임에서 보이는 키프레임의 내용을 복사
    const sourceKf = this.getKeyframeAtFrame(frame);

    // 기존 키프레임이 있으면 제거
    this.removeKeyframe(frame);

    const canvasData = sourceKf ? sourceKf.canvasData : null;
    const keyframe = new Keyframe(frame, canvasData);
    this.keyframes.push(keyframe);
    this._sortKeyframes();

    log.debug('키프레임 복제 추가됨', { layerId: this.id, frame, hasContent: !!canvasData });
    return keyframe;
  }

  /**
   * 키프레임 제거
   */
  removeKeyframe(frame) {
    const index = this.keyframes.findIndex(kf => kf.frame === frame);
    if (index !== -1) {
      this.keyframes.splice(index, 1);
      log.debug('키프레임 제거됨', { layerId: this.id, frame });
      return true;
    }
    return false;
  }

  /**
   * 키프레임 정렬
   */
  _sortKeyframes() {
    this.keyframes.sort((a, b) => a.frame - b.frame);
  }

  /**
   * 프레임 삽입 (홀드 추가) - 현재 프레임 이후의 모든 키프레임을 1프레임씩 뒤로 이동
   * @param {number} frame - 삽입 위치 프레임
   */
  insertFrame(frame) {
    for (const kf of this.keyframes) {
      if (kf.frame > frame) {
        kf.frame += 1;
      }
    }
    log.debug('프레임 삽입됨', { layerId: this.id, frame });
  }

  /**
   * 프레임 삭제 - 현재 프레임 이후의 모든 키프레임을 1프레임씩 앞으로 이동
   * @param {number} frame - 삭제할 프레임
   */
  deleteFrame(frame) {
    // 현재 프레임에 키프레임이 있으면 먼저 삭제
    const currentKeyframeIndex = this.keyframes.findIndex(kf => kf.frame === frame);
    if (currentKeyframeIndex !== -1) {
      this.keyframes.splice(currentKeyframeIndex, 1);
    }

    // 이후 키프레임들을 1프레임씩 앞으로 이동
    for (const kf of this.keyframes) {
      if (kf.frame > frame) {
        kf.frame -= 1;
      }
    }

    // 중첩된 키프레임 제거 (같은 프레임에 여러 키프레임이 있으면 첫 번째만 유지)
    const seen = new Set();
    this.keyframes = this.keyframes.filter(kf => {
      if (seen.has(kf.frame)) {
        return false;
      }
      seen.add(kf.frame);
      return true;
    });

    log.debug('프레임 삭제됨', { layerId: this.id, frame });
  }

  /**
   * 키프레임 범위 가져오기 (타임라인 UI용)
   * @returns {Array<{start: number, end: number, keyframe: Keyframe}>}
   */
  getKeyframeRanges(totalFrames) {
    const ranges = [];

    for (let i = 0; i < this.keyframes.length; i++) {
      const kf = this.keyframes[i];
      const nextKf = this.keyframes[i + 1];

      ranges.push({
        start: kf.frame,
        end: nextKf ? nextKf.frame - 1 : totalFrames - 1,
        keyframe: kf
      });
    }

    return ranges;
  }

  /**
   * JSON 직렬화
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      visible: this.visible,
      locked: this.locked,
      color: this.color,
      opacity: this.opacity,
      keyframes: this.keyframes.map(kf => kf.toJSON())
    };
  }

  /**
   * JSON에서 복원
   */
  static fromJSON(json) {
    const layer = new DrawingLayer({
      id: json.id,
      name: json.name,
      visible: json.visible,
      locked: json.locked,
      color: json.color,
      opacity: json.opacity
    });
    layer.keyframes = json.keyframes.map(kf => Keyframe.fromJSON(kf));
    return layer;
  }
}

export default DrawingLayer;
