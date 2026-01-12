/**
 * baeframe - Drawing Canvas Module
 * 캔버스 그리기 작업 처리
 */

import { createLogger } from '../logger.js';

const log = createLogger('DrawingCanvas');

/**
 * 그리기 도구 타입
 */
export const DrawingTool = {
  PEN: 'pen',
  BRUSH: 'brush',
  ERASER: 'eraser',
  LINE: 'line',
  ARROW: 'arrow',
  RECT: 'rect',
  CIRCLE: 'circle'
};

/**
 * 드로잉 캔버스 클래스
 */
export class DrawingCanvas extends EventTarget {
  constructor(canvas) {
    super();

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // 그리기 설정
    this.tool = DrawingTool.PEN;
    this.color = '#ff4757';
    this.lineWidth = 3;
    this.opacity = 1;

    // 외곽선 설정
    this.strokeEnabled = false;  // 외곽선 활성화
    this.strokeWidth = 3;        // 외곽선 두께 (기본 3px)
    this.strokeColor = '#ffffff'; // 외곽선 색상 (기본 흰색)

    // 상태
    this.isDrawing = false;
    this.lastX = 0;
    this.lastY = 0;
    this.startX = 0;
    this.startY = 0;

    // 스트로크 경로 저장 (외곽선용)
    this.currentStrokePath = [];

    // 임시 캔버스 (도형 그리기용)
    this.tempCanvas = document.createElement('canvas');
    this.tempCtx = this.tempCanvas.getContext('2d');

    // 현재 키프레임의 백업 (도형 그리기 중 사용)
    this.backupImageData = null;

    // 이벤트 리스너 설정
    this._setupEventListeners();

    log.info('DrawingCanvas 초기화됨');
  }

  /**
   * 이벤트 리스너 설정
   */
  _setupEventListeners() {
    // 마우스 이벤트
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.canvas.addEventListener('mouseleave', (e) => this._onMouseUp(e));

    // 터치 이벤트 (태블릿 지원)
    this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e));
    this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e));
    this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));
  }

  /**
   * 캔버스 크기 동기화
   */
  syncSize(width, height) {
    // 현재 내용 백업
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    // 크기 변경
    this.canvas.width = width;
    this.canvas.height = height;
    this.tempCanvas.width = width;
    this.tempCanvas.height = height;

    // 내용 복원 (크기가 같을 때만)
    if (imageData.width === width && imageData.height === height) {
      this.ctx.putImageData(imageData, 0, 0);
    }
  }

  /**
   * 마우스 좌표 계산 (캔버스 내부 좌표로 변환)
   */
  _getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  /**
   * 마우스 다운
   */
  _onMouseDown(e) {
    if (!this.canvas.classList.contains('active')) return;

    const coords = this._getCanvasCoords(e);
    this.isDrawing = true;
    this.lastX = coords.x;
    this.lastY = coords.y;
    this.startX = coords.x;
    this.startY = coords.y;

    // 스트로크 경로 초기화
    this.currentStrokePath = [{ x: coords.x, y: coords.y }];

    // 도형 도구 또는 외곽선 활성화 시 현재 상태 백업
    if (this._isShapeTool() || (this.strokeEnabled && this._isFreeDrawTool())) {
      this.backupImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    // 그리기 시작 이벤트 발생
    this._emit('drawstart', { x: coords.x, y: coords.y, tool: this.tool });

    // 펜/브러시는 점 찍기
    if (this._isFreeDrawTool()) {
      this._drawPoint(coords.x, coords.y);
    }
  }

  /**
   * 마우스 이동
   */
  _onMouseMove(e) {
    if (!this.isDrawing) return;

    const coords = this._getCanvasCoords(e);

    if (this._isShapeTool()) {
      // 도형 도구: 실시간 미리보기
      this._drawShapePreview(coords.x, coords.y);
    } else if (this._isFreeDrawTool()) {
      // 펜/브러시/지우개: 자유 그리기
      this.currentStrokePath.push({ x: coords.x, y: coords.y });

      if (this.strokeEnabled && this.tool !== DrawingTool.ERASER) {
        // 외곽선 모드: 전체 경로를 다시 그리기
        this._drawStrokeWithOutline();
      } else {
        // 일반 모드: 세그먼트 그리기
        this._drawLine(this.lastX, this.lastY, coords.x, coords.y);
      }

      this.lastX = coords.x;
      this.lastY = coords.y;
    }
  }

  /**
   * 마우스 업
   */
  _onMouseUp(e) {
    if (!this.isDrawing) return;

    this.isDrawing = false;

    // 도형 도구일 경우 최종 그리기
    if (this._isShapeTool() && e.type !== 'mouseleave') {
      const coords = this._getCanvasCoords(e);
      this._drawShapeFinal(coords.x, coords.y);
    }

    // 백업 초기화
    this.backupImageData = null;

    // 그리기 완료 이벤트 발생
    this._emit('drawend', { tool: this.tool });
  }

  /**
   * 터치 시작
   */
  _onTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    this._onMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
  }

  /**
   * 터치 이동
   */
  _onTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    this._onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
  }

  /**
   * 터치 종료
   */
  _onTouchEnd(e) {
    e.preventDefault();
    this._onMouseUp({ type: 'touchend' });
  }

  /**
   * 도형 도구인지 확인
   */
  _isShapeTool() {
    return [DrawingTool.LINE, DrawingTool.ARROW, DrawingTool.RECT, DrawingTool.CIRCLE].includes(this.tool);
  }

  /**
   * 자유 그리기 도구인지 확인
   */
  _isFreeDrawTool() {
    return [DrawingTool.PEN, DrawingTool.BRUSH, DrawingTool.ERASER].includes(this.tool);
  }

  /**
   * 외곽선과 함께 전체 스트로크 그리기
   */
  _drawStrokeWithOutline() {
    if (!this.backupImageData || this.currentStrokePath.length < 1) return;

    // 백업에서 복원
    this.ctx.putImageData(this.backupImageData, 0, 0);

    const path = this.currentStrokePath;

    this.ctx.save();

    // 1. 외곽선 먼저 그리기
    this.ctx.lineCap = this.tool === DrawingTool.BRUSH ? 'square' : 'round';
    this.ctx.lineJoin = this.tool === DrawingTool.BRUSH ? 'miter' : 'round';
    this.ctx.lineWidth = this.lineWidth + (this.strokeWidth * 2);
    this.ctx.globalAlpha = this.opacity;
    this.ctx.strokeStyle = this.strokeColor;

    if (path.length === 1) {
      // 점 하나
      this.ctx.fillStyle = this.strokeColor;
      this.ctx.beginPath();
      if (this.tool === DrawingTool.BRUSH) {
        const size = (this.lineWidth / 2) + this.strokeWidth;
        this.ctx.rect(path[0].x - size, path[0].y - size, size * 2, size * 2);
      } else {
        this.ctx.arc(path[0].x, path[0].y, (this.lineWidth / 2) + this.strokeWidth, 0, Math.PI * 2);
      }
      this.ctx.fill();
    } else {
      // 경로
      this.ctx.beginPath();
      this.ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        this.ctx.lineTo(path[i].x, path[i].y);
      }
      this.ctx.stroke();
    }

    // 2. 메인 색상 그리기
    this.ctx.lineCap = this.tool === DrawingTool.BRUSH ? 'square' : 'round';
    this.ctx.lineJoin = this.tool === DrawingTool.BRUSH ? 'miter' : 'round';
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.strokeStyle = this.color;
    this.ctx.fillStyle = this.color;

    if (path.length === 1) {
      // 점 하나
      this.ctx.beginPath();
      if (this.tool === DrawingTool.BRUSH) {
        const size = this.lineWidth / 2;
        this.ctx.rect(path[0].x - size, path[0].y - size, size * 2, size * 2);
      } else {
        this.ctx.arc(path[0].x, path[0].y, this.lineWidth / 2, 0, Math.PI * 2);
      }
      this.ctx.fill();
    } else {
      // 경로
      this.ctx.beginPath();
      this.ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        this.ctx.lineTo(path[i].x, path[i].y);
      }
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * 점 그리기
   */
  _drawPoint(x, y) {
    this.ctx.save();
    const isSquare = this.tool === DrawingTool.BRUSH;

    // 외곽선 먼저 그리기 (지우개가 아니고 외곽선이 활성화된 경우)
    if (this.strokeEnabled && this.tool !== DrawingTool.ERASER) {
      this.ctx.globalAlpha = this.opacity;
      this.ctx.fillStyle = this.strokeColor;
      this.ctx.beginPath();
      if (isSquare) {
        const size = (this.lineWidth / 2) + this.strokeWidth;
        this.ctx.rect(x - size, y - size, size * 2, size * 2);
      } else {
        this.ctx.arc(x, y, (this.lineWidth / 2) + this.strokeWidth, 0, Math.PI * 2);
      }
      this.ctx.fill();
    }

    // 메인 색상
    this._setupContext();
    this.ctx.beginPath();
    if (isSquare) {
      const size = this.lineWidth / 2;
      this.ctx.rect(x - size, y - size, size * 2, size * 2);
    } else {
      this.ctx.arc(x, y, this.lineWidth / 2, 0, Math.PI * 2);
    }
    this.ctx.fill();

    this.ctx.restore();
  }

  /**
   * 선 그리기
   */
  _drawLine(x1, y1, x2, y2) {
    this.ctx.save();
    const isSquare = this.tool === DrawingTool.BRUSH;

    // 외곽선 먼저 그리기 (지우개가 아니고 외곽선이 활성화된 경우)
    // 참고: 세그먼트별 외곽선은 끊김 문제가 있어서, 외곽선 모드는 _drawStrokeWithOutline에서 처리
    // 이 코드는 외곽선 비활성화 시에만 사용됨

    // 메인 색상
    this._setupContext();
    this.ctx.lineCap = isSquare ? 'square' : 'round';
    this.ctx.lineJoin = isSquare ? 'miter' : 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();

    this.ctx.restore();
  }

  /**
   * 컨텍스트 설정
   */
  _setupContext() {
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.globalAlpha = this.opacity;

    if (this.tool === DrawingTool.ERASER) {
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.strokeStyle = 'rgba(0,0,0,1)';
      this.ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.strokeStyle = this.color;
      this.ctx.fillStyle = this.color;
    }
  }

  /**
   * 도형 미리보기 그리기
   */
  _drawShapePreview(x, y) {
    if (!this.backupImageData) return;

    // 백업에서 복원
    this.ctx.putImageData(this.backupImageData, 0, 0);

    // 미리보기 그리기
    this._drawShape(this.startX, this.startY, x, y, false);
  }

  /**
   * 도형 최종 그리기
   */
  _drawShapeFinal(x, y) {
    if (!this.backupImageData) return;

    // 백업에서 복원
    this.ctx.putImageData(this.backupImageData, 0, 0);

    // 최종 그리기
    this._drawShape(this.startX, this.startY, x, y, true);
  }

  /**
   * 도형 그리기
   */
  _drawShape(x1, y1, x2, y2, isFinal) {
    this.ctx.save();
    this._setupContext();

    switch (this.tool) {
    case DrawingTool.LINE:
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
      break;

    case DrawingTool.ARROW:
      this._drawArrow(x1, y1, x2, y2);
      break;

    case DrawingTool.RECT:
      this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      break;

    case DrawingTool.CIRCLE:
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      const cx = x1 + (x2 - x1) / 2;
      const cy = y1 + (y2 - y1) / 2;

      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      this.ctx.stroke();
      break;
    }

    this.ctx.restore();
  }

  /**
   * 화살표 그리기
   */
  _drawArrow(x1, y1, x2, y2) {
    const headLength = Math.max(15, this.lineWidth * 4);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    // 선
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();

    // 화살촉
    this.ctx.beginPath();
    this.ctx.moveTo(x2, y2);
    this.ctx.lineTo(
      x2 - headLength * Math.cos(angle - Math.PI / 6),
      y2 - headLength * Math.sin(angle - Math.PI / 6)
    );
    this.ctx.moveTo(x2, y2);
    this.ctx.lineTo(
      x2 - headLength * Math.cos(angle + Math.PI / 6),
      y2 - headLength * Math.sin(angle + Math.PI / 6)
    );
    this.ctx.stroke();
  }

  /**
   * 캔버스 초기화
   */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    log.debug('캔버스 초기화됨');
  }

  /**
   * 캔버스 데이터 가져오기 (저장용)
   */
  getImageData() {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * 캔버스 데이터를 base64로 가져오기
   */
  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }

  /**
   * 캔버스에 이미지 데이터 로드
   */
  putImageData(imageData) {
    if (!imageData) {
      this.clear();
      return;
    }

    // ImageData 객체인 경우
    if (imageData instanceof ImageData) {
      this.ctx.putImageData(imageData, 0, 0);
    }
    // base64 문자열인 경우
    else if (typeof imageData === 'string') {
      const img = new Image();
      img.onload = () => {
        this.clear();
        this.ctx.drawImage(img, 0, 0);
      };
      img.src = imageData;
    }
  }

  /**
   * 캔버스가 비어있는지 확인
   */
  isEmpty() {
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;

    // 알파 채널 확인
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return false;
    }
    return true;
  }

  /**
   * 도구 설정
   */
  setTool(tool) {
    this.tool = tool;
    log.debug('도구 변경', { tool });
  }

  /**
   * 색상 설정
   */
  setColor(color) {
    this.color = color;
    log.debug('색상 변경', { color });
  }

  /**
   * 선 두께 설정
   */
  setLineWidth(width) {
    this.lineWidth = width;
    log.debug('선 두께 변경', { width });
  }

  /**
   * 투명도 설정
   */
  setOpacity(opacity) {
    this.opacity = opacity;
  }

  /**
   * 외곽선 활성화/비활성화
   */
  setStrokeEnabled(enabled) {
    this.strokeEnabled = enabled;
    log.debug('외곽선 활성화', { enabled });
  }

  /**
   * 외곽선 두께 설정
   */
  setStrokeWidth(width) {
    this.strokeWidth = width;
    log.debug('외곽선 두께 변경', { width });
  }

  /**
   * 외곽선 색상 설정
   */
  setStrokeColor(color) {
    this.strokeColor = color;
    log.debug('외곽선 색상 변경', { color });
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
    // 이벤트 리스너 제거는 canvas 요소 제거 시 자동으로 됨
    log.info('DrawingCanvas 정리됨');
  }
}

export default DrawingCanvas;
