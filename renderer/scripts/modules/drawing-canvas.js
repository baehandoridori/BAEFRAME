/**
 * baeframe - Drawing Canvas Module
 * 캔버스 그리기 작업 처리
 */

import { createLogger } from '../logger.js';
import { ERASER_MODES, normalizeEraserMode } from './drawing-stroke-records.js';
import { drawFreehandStroke } from './freehand-stroke-renderer.js';

const log = createLogger('DrawingCanvas');

/**
 * 그리기 도구 타입
 */
export const DrawingTool = {
  SELECT: 'select',
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
    this.activeTool = DrawingTool.PEN;
    this.eraserMode = ERASER_MODES.PIXEL;
    this.activeEraserMode = ERASER_MODES.PIXEL;
    this.color = '#ff4757';
    this.lineWidth = 3;
    this.opacity = 1;

    // 외곽선 설정
    this.strokeEnabled = false;  // 외곽선 활성화
    this.strokeWidth = 3;        // 외곽선 두께 (기본 3px)
    this.strokeColor = '#ffffff'; // 외곽선 색상 (기본 흰색)

    // 상태
    this.isDrawing = false;
    this.canDraw = null;
    this._modifierCtrlDown = false;
    this.isSizeAdjusting = false;
    this._sizeAdjustStartX = 0;
    this._sizeAdjustStartY = 0;
    this._sizeAdjustStartSize = 3;
    this._sizeAdjustMoveHandler = null;
    this._sizeAdjustEndHandler = null;
    this._sizeAdjustUsesPointerEvents = false;
    this._activeSizeAdjustPointerId = null;
    this._activeDrawPointerId = null;
    this.lastX = 0;
    this.lastY = 0;
    this.startX = 0;
    this.startY = 0;

    // 선택 도구 상태
    this.selectionCanvas = null;
    this.selection = null;
    this.floatingImage = null;
    this.floatingPos = null;
    this._selectPhase = null;
    this._selectGrabOffset = null;
    this._selectClipboard = null;

    // 스트로크 경로 저장 (외곽선용)
    this.currentStrokePath = [];

    // 임시 캔버스 (도형 그리기용)
    this.tempCanvas = document.createElement('canvas');
    this.tempCtx = this.tempCanvas.getContext('2d');

    // 현재 키프레임의 백업 (도형 그리기 중 사용)
    this.backupImageData = null;

    // AbortController for event listener cleanup
    this._abortController = new AbortController();

    // 이벤트 리스너 설정
    this._setupEventListeners();

    log.info('DrawingCanvas 초기화됨');
  }

  /**
   * 이벤트 리스너 설정
   */
  _setupEventListeners() {
    const signal = this._abortController.signal;

    // 포인터 이벤트 (마우스/펜/터치 통합)
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e), { signal });
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e), { signal });
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e), { signal });
    this.canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e), { signal });
    this.canvas.addEventListener('contextmenu', (e) => {
      if (e.altKey || this.isSizeAdjusting) {
        e.preventDefault();
      }
    }, { signal });

    // 펜/터치 유래 이벤트는 ctrlKey가 비어 오는 환경이 있어 전역 Ctrl 상태를 함께 본다.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Control') this._modifierCtrlDown = true;
    }, { signal });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Control') this._modifierCtrlDown = false;
    }, { signal });
    window.addEventListener('blur', () => {
      this._modifierCtrlDown = false;
    }, { signal });
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

    if (e.altKey && (e.button === 0 || e.button === 2)) {
      e.preventDefault?.();
      this._beginSizeAdjust(e);
      return;
    }

    if (this._isCtrlActive(e)) {
      e.preventDefault?.();
    }

    if (typeof this.canDraw === 'function' && !this.canDraw()) {
      this._emit('drawblocked', {
        tool: this._resolveEffectiveTool(e),
        ctrlKey: this._isCtrlActive(e)
      });
      return;
    }

    if (this.tool === DrawingTool.SELECT) {
      this._onSelectPointerDown(e);
      return;
    }

    const coords = this._getCanvasCoords(e);
    this.activeTool = this._resolveEffectiveTool(e);
    this.activeEraserMode = this.eraserMode;
    this.isDrawing = true;
    this.lastX = coords.x;
    this.lastY = coords.y;
    this.startX = coords.x;
    this.startY = coords.y;

    // 스트로크 경로 초기화
    this.currentStrokePath = [{ x: coords.x, y: coords.y }];

    // 도형 도구 또는 부드러운 자유 그리기 렌더링 시 현재 상태 백업
    if (this._isShapeTool(this.activeTool) || this._isSmoothFreeDrawTool(this.activeTool)) {
      this.backupImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    // 그리기 시작 이벤트 발생
    this._emit('drawstart', this._createDrawEventDetail({
      x: coords.x,
      y: coords.y,
      ctrlKey: this._isCtrlActive(e)
    }));

    // 펜/브러시는 점 찍기
    if (this._isSmoothFreeDrawTool(this.activeTool) && !this._isStrokeEraserActive()) {
      this._drawSmoothedFreehandStroke(this.currentStrokePath, {
        tool: this.activeTool,
        last: false
      });
    } else if (this._isFreeDrawTool(this.activeTool) && !this._isStrokeEraserActive()) {
      this._drawPoint(coords.x, coords.y, this.activeTool);
    }
  }

  _onPointerDown(e) {
    if (!this.canvas.classList.contains('active')) return;
    if (!e.isPrimary) return;
    if (!e.altKey && e.button !== 0) return;
    this._activeDrawPointerId = e.pointerId;
    this.canvas.setPointerCapture?.(e.pointerId);
    this._onMouseDown(e);
  }

  _onPointerMove(e) {
    if (this._activeDrawPointerId !== e.pointerId) return;
    if (this._selectPhase) {
      this._onSelectPointerMove(e);
      return;
    }
    this._onMouseMove(e);
  }

  _onPointerUp(e) {
    if (this._activeDrawPointerId !== e.pointerId) return;
    this._activeDrawPointerId = null;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) {
      this.canvas.releasePointerCapture?.(e.pointerId);
    }
    if (this._selectPhase) {
      this._onSelectPointerUp(e);
      return;
    }
    this._onMouseUp(e);
  }

  _beginSizeAdjust(e) {
    if (this.isSizeAdjusting) return;

    this.isSizeAdjusting = true;
    this._sizeAdjustStartX = e.clientX;
    this._sizeAdjustStartY = e.clientY;
    this._sizeAdjustStartSize = Math.min(50, Math.max(1, parseInt(this.lineWidth) || 3));
    this._sizeAdjustUsesPointerEvents = typeof e.pointerId === 'number';
    this._activeSizeAdjustPointerId = this._sizeAdjustUsesPointerEvents ? e.pointerId : null;
    this._sizeAdjustMoveHandler = (event) => this._updateSizeAdjust(event);
    this._sizeAdjustEndHandler = (event) => {
      if (
        this._sizeAdjustUsesPointerEvents &&
        typeof event?.pointerId === 'number' &&
        event.pointerId !== this._activeSizeAdjustPointerId
      ) {
        return;
      }
      this._endSizeAdjust();
    };

    if (this._sizeAdjustUsesPointerEvents) {
      this.canvas.setPointerCapture?.(e.pointerId);
      window.addEventListener('pointermove', this._sizeAdjustMoveHandler, { signal: this._abortController.signal });
      window.addEventListener('pointerup', this._sizeAdjustEndHandler, { signal: this._abortController.signal });
      window.addEventListener('pointercancel', this._sizeAdjustEndHandler, { signal: this._abortController.signal });
    } else {
      window.addEventListener('mousemove', this._sizeAdjustMoveHandler, { signal: this._abortController.signal });
      window.addEventListener('mouseup', this._sizeAdjustEndHandler, { signal: this._abortController.signal });
    }

    this._emit('sizeadjuststart', {
      size: this.lineWidth,
      clientX: e.clientX,
      clientY: e.clientY
    });
  }

  _updateSizeAdjust(e) {
    if (!this.isSizeAdjusting) return;
    if (
      this._sizeAdjustUsesPointerEvents &&
      typeof e.pointerId === 'number' &&
      e.pointerId !== this._activeSizeAdjustPointerId
    ) {
      return;
    }
    e.preventDefault?.();

    const delta = e.clientX - this._sizeAdjustStartX;
    const nextSize = Math.min(50, Math.max(1, Math.round(this._sizeAdjustStartSize + (delta / 4))));
    this.setLineWidth(nextSize);
    this._emit('sizeadjust', {
      size: nextSize,
      clientX: this._sizeAdjustStartX,
      clientY: this._sizeAdjustStartY
    });
  }

  _endSizeAdjust() {
    if (!this.isSizeAdjusting) return;
    this.isSizeAdjusting = false;

    this._removeSizeAdjustListeners();
    this._emit('sizeadjustend', {
      size: this.lineWidth,
      clientX: this._sizeAdjustStartX,
      clientY: this._sizeAdjustStartY
    });
  }

  _removeSizeAdjustListeners() {
    if (this._sizeAdjustMoveHandler) {
      window.removeEventListener('mousemove', this._sizeAdjustMoveHandler);
      window.removeEventListener('pointermove', this._sizeAdjustMoveHandler);
      this._sizeAdjustMoveHandler = null;
    }
    if (this._sizeAdjustEndHandler) {
      window.removeEventListener('mouseup', this._sizeAdjustEndHandler);
      window.removeEventListener('pointerup', this._sizeAdjustEndHandler);
      window.removeEventListener('pointercancel', this._sizeAdjustEndHandler);
      this._sizeAdjustEndHandler = null;
    }
    this._sizeAdjustUsesPointerEvents = false;
    this._activeSizeAdjustPointerId = null;
  }

  /**
   * 마우스 이동
   */
  _onMouseMove(e) {
    if (!this.isDrawing) return;

    const coords = this._getCanvasCoords(e);
    this.currentStrokePath.push({ x: coords.x, y: coords.y });

    // 실시간 스트로크 포인트 이벤트 (협업 스트리밍용)
    this._emit('drawmove', this._createDrawEventDetail({
      x: coords.x,
      y: coords.y,
      ctrlKey: this._isCtrlActive(e)
    }));

    if (this._isStrokeEraserActive()) {
      this.lastX = coords.x;
      this.lastY = coords.y;
      return;
    }

    if (this._isShapeTool(this.activeTool)) {
      // 도형 도구: 실시간 미리보기
      this._drawShapePreview(coords.x, coords.y);
    } else if (this._isFreeDrawTool(this.activeTool)) {
      // 펜/브러시/지우개: 자유 그리기
      if (this._isSmoothFreeDrawTool(this.activeTool)) {
        this._drawSmoothedFreehandStroke(this.currentStrokePath, {
          tool: this.activeTool,
          last: false
        });
      } else if (this.strokeEnabled && this.activeTool !== DrawingTool.ERASER) {
        // 외곽선 모드: 전체 경로를 다시 그리기
        this._drawStrokeWithOutline(this.activeTool);
      } else {
        // 일반 모드: 세그먼트 그리기
        this._drawLine(this.lastX, this.lastY, coords.x, coords.y, this.activeTool);
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
    if (this._isShapeTool(this.activeTool) && e.type !== 'pointercancel' && Number.isFinite(e.clientX)) {
      const coords = this._getCanvasCoords(e);
      this._drawShapeFinal(coords.x, coords.y);
    }

    if (this._isSmoothFreeDrawTool(this.activeTool) && !this._isStrokeEraserActive()) {
      this._drawSmoothedFreehandStroke(this.currentStrokePath, {
        tool: this.activeTool,
        last: true
      });
    }

    // 백업 초기화
    this.backupImageData = null;

    // 그리기 완료 이벤트 발생
    this._emit('drawend', this._createDrawEventDetail({
      ctrlKey: this._isCtrlActive(e)
    }));
    this.activeTool = this.tool;
    this.activeEraserMode = this.eraserMode;
  }

  /**
   * 도형 도구인지 확인
   */
  _isShapeTool(tool = this._getActiveTool()) {
    return [DrawingTool.LINE, DrawingTool.ARROW, DrawingTool.RECT, DrawingTool.CIRCLE].includes(tool);
  }

  /**
   * 자유 그리기 도구인지 확인
   */
  _isFreeDrawTool(tool = this._getActiveTool()) {
    return [DrawingTool.PEN, DrawingTool.BRUSH, DrawingTool.ERASER].includes(tool);
  }

  _isSmoothFreeDrawTool(tool = this._getActiveTool()) {
    return [DrawingTool.PEN, DrawingTool.BRUSH].includes(tool);
  }

  _getActiveTool() {
    return this.activeTool || this.tool;
  }

  _isCtrlActive(e) {
    return e?.ctrlKey === true || this._modifierCtrlDown === true;
  }

  _resolveEffectiveTool(e) {
    if ((this.tool === DrawingTool.PEN || this.tool === DrawingTool.BRUSH) && this._isCtrlActive(e)) {
      return DrawingTool.ERASER;
    }
    return this.tool;
  }

  _isStrokeEraserActive() {
    return this._getActiveTool() === DrawingTool.ERASER && this.activeEraserMode === ERASER_MODES.STROKE;
  }

  _createDrawEventDetail(extra = {}) {
    return {
      tool: this._getActiveTool(),
      originalTool: this.tool,
      effectiveTool: this.activeTool,
      eraserMode: this.activeEraserMode,
      points: this.currentStrokePath.map(point => ({ ...point })),
      color: this.color,
      lineWidth: this.lineWidth,
      opacity: this.opacity,
      strokeEnabled: this.strokeEnabled,
      strokeWidth: this.strokeWidth,
      strokeColor: this.strokeColor,
      ...extra
    };
  }

  _drawSmoothedFreehandStroke(points, options = {}) {
    const shouldRestoreBackup = options.restoreBackup !== false;
    if (shouldRestoreBackup) {
      if (!this.backupImageData) return false;
      this.ctx.putImageData(this.backupImageData, 0, 0);
    }

    return drawFreehandStroke(this.ctx, points, {
      tool: options.tool || this._getActiveTool(),
      color: options.color || this.color,
      lineWidth: options.lineWidth || this.lineWidth,
      opacity: Number.isFinite(Number(options.opacity)) ? Number(options.opacity) : this.opacity,
      strokeEnabled: options.strokeEnabled ?? this.strokeEnabled,
      strokeWidth: options.strokeWidth ?? this.strokeWidth,
      strokeColor: options.strokeColor || this.strokeColor,
      last: options.last !== false
    });
  }

  /**
   * 외곽선과 함께 전체 스트로크 그리기
   */
  _drawStrokeWithOutline(tool = this._getActiveTool()) {
    this._drawSmoothedFreehandStroke(this.currentStrokePath, {
      tool,
      strokeEnabled: true,
      last: false
    });
  }

  /**
   * 점 그리기
   */
  _drawPoint(x, y, tool = this._getActiveTool()) {
    this.ctx.save();
    const isSquare = tool === DrawingTool.BRUSH;

    // 외곽선 먼저 그리기 (지우개가 아니고 외곽선이 활성화된 경우)
    if (this.strokeEnabled && tool !== DrawingTool.ERASER) {
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
    this._setupContext(tool);
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
  _drawLine(x1, y1, x2, y2, tool = this._getActiveTool()) {
    this.ctx.save();
    const isSquare = tool === DrawingTool.BRUSH;

    // 외곽선 먼저 그리기 (지우개가 아니고 외곽선이 활성화된 경우)
    // 참고: 세그먼트별 외곽선은 끊김 문제가 있어서, 외곽선 모드는 _drawStrokeWithOutline에서 처리
    // 이 코드는 외곽선 비활성화 시에만 사용됨

    // 메인 색상
    this._setupContext(tool);
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
  _setupContext(tool = this._getActiveTool()) {
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.globalAlpha = this.opacity;

    if (tool === DrawingTool.ERASER) {
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
  _drawShape(x1, y1, x2, y2, _isFinal) {
    const outlineEnabled = this.strokeEnabled && this.strokeWidth > 0 && this.activeTool !== DrawingTool.ERASER;

    this.ctx.save();

    if (outlineEnabled) {
      this._setupContext(this.activeTool);
      this.ctx.strokeStyle = this.strokeColor;
      this.ctx.fillStyle = this.strokeColor;
      this.ctx.lineWidth = this.lineWidth + (this.strokeWidth * 2);
      this._traceShapePath(x1, y1, x2, y2);
    }

    this._setupContext(this.activeTool);
    this._traceShapePath(x1, y1, x2, y2);

    this.ctx.restore();
  }

  /**
   * 현재 activeTool 기준으로 도형 지오메트리를 현재 ctx 스타일로 그림
   */
  _traceShapePath(x1, y1, x2, y2) {
    switch (this.activeTool) {
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

    case DrawingTool.CIRCLE: {
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      const cx = x1 + (x2 - x1) / 2;
      const cy = y1 + (y2 - y1) / 2;

      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      this.ctx.stroke();
      break;
    }
    }
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
  clear(options = {}) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!options.silent) {
      log.debug('캔버스 초기화됨');
    }
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
   * base64 이미지 데이터를 현재 캔버스에 그리기
   */
  drawImageDataUrl(imageData) {
    return new Promise((resolve) => {
      if (!imageData || typeof imageData !== 'string') {
        resolve(false);
        return;
      }

      const img = new Image();
      img.onload = () => {
        this.ctx.drawImage(img, 0, 0);
        resolve(true);
      };
      img.onerror = () => {
        log.warn('이미지 데이터 그리기 실패');
        resolve(false);
      };
      img.src = imageData;
    });
  }

  /**
   * 저장된 펜/브러시 획을 다시 그리기
   */
  drawStrokeRecord(record) {
    const points = Array.isArray(record?.points) ? record.points : [];
    if (points.length === 0) return;

    const tool = record.tool || DrawingTool.PEN;
    const lineWidth = Math.max(1, Number(record.lineWidth) || this.lineWidth);
    const opacity = Number.isFinite(Number(record.opacity)) ? Number(record.opacity) : 1;
    const color = record.color || this.color;
    const strokeEnabled = record.strokeEnabled === true;
    const strokeWidth = Math.max(0, Number(record.strokeWidth) || 0);
    const strokeColor = record.strokeColor || this.strokeColor;
    const isSquare = tool === DrawingTool.BRUSH;

    if (this._isSmoothFreeDrawTool(tool)) {
      this._drawSmoothedFreehandStroke(points, {
        restoreBackup: false,
        tool,
        color,
        lineWidth,
        opacity,
        strokeEnabled,
        strokeWidth,
        strokeColor,
        last: true
      });
      return;
    }

    const drawPath = (style, width) => {
      this.ctx.lineCap = isSquare ? 'square' : 'round';
      this.ctx.lineJoin = isSquare ? 'miter' : 'round';
      this.ctx.lineWidth = width;
      this.ctx.strokeStyle = style;
      this.ctx.fillStyle = style;

      if (points.length === 1) {
        const size = width / 2;
        this.ctx.beginPath();
        if (isSquare) {
          this.ctx.rect(points[0].x - size, points[0].y - size, size * 2, size * 2);
        } else {
          this.ctx.arc(points[0].x, points[0].y, size, 0, Math.PI * 2);
        }
        this.ctx.fill();
        return;
      }

      this.ctx.beginPath();
      this.ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        this.ctx.lineTo(points[i].x, points[i].y);
      }
      this.ctx.stroke();
    };

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = opacity;

    if (strokeEnabled && strokeWidth > 0) {
      drawPath(strokeColor, lineWidth + (strokeWidth * 2));
    }
    drawPath(color, lineWidth);

    this.ctx.restore();
  }

  // ====== 선택 도구 (select) ======

  _onSelectPointerDown(e) {
    const coords = this._getCanvasCoords(e);
    if (this.selection && this._isInsideSelection(coords)) {
      if (!this.floatingImage) this._liftSelection();
      if (!this.floatingImage) return;
      this._selectPhase = 'move';
      this._selectGrabOffset = {
        x: coords.x - this.floatingPos.x,
        y: coords.y - this.floatingPos.y
      };
    } else {
      this.commitSelection();
      this._selectPhase = 'marquee';
      this.selection = { x: coords.x, y: coords.y, w: 0, h: 0 };
      this._selectGrabOffset = { x: coords.x, y: coords.y };
    }
    this._renderSelectionOverlay();
  }

  _onSelectPointerMove(e) {
    const coords = this._getCanvasCoords(e);
    if (this._selectPhase === 'marquee') {
      const startX = this._selectGrabOffset.x;
      const startY = this._selectGrabOffset.y;
      this.selection = {
        x: Math.min(startX, coords.x),
        y: Math.min(startY, coords.y),
        w: Math.abs(coords.x - startX),
        h: Math.abs(coords.y - startY)
      };
    } else if (this._selectPhase === 'move' && this.floatingImage) {
      this.floatingPos = {
        x: coords.x - this._selectGrabOffset.x,
        y: coords.y - this._selectGrabOffset.y
      };
      this.selection = {
        x: this.floatingPos.x,
        y: this.floatingPos.y,
        w: this.floatingImage.width,
        h: this.floatingImage.height
      };
    }
    this._renderSelectionOverlay();
  }

  _onSelectPointerUp(_e) {
    if (this._selectPhase === 'marquee') {
      const rect = this._normalizedSelection();
      if (!rect || rect.w < 2 || rect.h < 2) {
        this.selection = null;
      }
    }
    this._selectPhase = null;
    this._renderSelectionOverlay();
  }

  _isInsideSelection(point) {
    const rect = this._normalizedSelection();
    if (!rect) return false;
    return point.x >= rect.x && point.x <= rect.x + rect.w &&
           point.y >= rect.y && point.y <= rect.y + rect.h;
  }

  _normalizedSelection() {
    if (!this.selection) return null;
    const x = Math.max(0, Math.round(this.selection.x));
    const y = Math.max(0, Math.round(this.selection.y));
    const right = Math.min(this.canvas.width, Math.round(this.selection.x + this.selection.w));
    const bottom = Math.min(this.canvas.height, Math.round(this.selection.y + this.selection.h));
    const w = right - x;
    const h = bottom - y;
    if (w < 1 || h < 1) return null;
    return { x, y, w, h };
  }

  _liftSelection() {
    const rect = this._normalizedSelection();
    if (!rect) {
      this.selection = null;
      return;
    }
    this._emit('selectionliftstart');
    const lifted = document.createElement('canvas');
    lifted.width = rect.w;
    lifted.height = rect.h;
    lifted.getContext('2d').drawImage(this.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    this.floatingImage = lifted;
    this.floatingPos = { x: rect.x, y: rect.y };
    this.selection = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    this.ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
  }

  commitSelection() {
    const hadFloating = !!this.floatingImage;
    if (hadFloating) {
      this.ctx.drawImage(this.floatingImage, Math.round(this.floatingPos.x), Math.round(this.floatingPos.y));
      this.floatingImage = null;
      this.floatingPos = null;
    }
    this.selection = null;
    this._selectPhase = null;
    this._clearSelectionOverlay();
    if (hadFloating) {
      this._emit('selectioncommitted');
    }
    return hadFloating;
  }

  copySelection() {
    if (this.floatingImage) {
      const copy = document.createElement('canvas');
      copy.width = this.floatingImage.width;
      copy.height = this.floatingImage.height;
      copy.getContext('2d').drawImage(this.floatingImage, 0, 0);
      this._selectClipboard = copy;
      return true;
    }
    const rect = this._normalizedSelection();
    if (!rect) return false;
    const copy = document.createElement('canvas');
    copy.width = rect.w;
    copy.height = rect.h;
    copy.getContext('2d').drawImage(this.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    this._selectClipboard = copy;
    return true;
  }

  hasSelectionClipboard() {
    return !!this._selectClipboard;
  }

  pasteSelection() {
    if (!this._selectClipboard) return false;
    if (typeof this.canDraw === 'function' && !this.canDraw()) {
      this._emit('drawblocked', {
        tool: DrawingTool.SELECT,
        ctrlKey: false
      });
      return false;
    }
    this.commitSelection();
    this._emit('selectionliftstart');
    const pasted = document.createElement('canvas');
    pasted.width = this._selectClipboard.width;
    pasted.height = this._selectClipboard.height;
    pasted.getContext('2d').drawImage(this._selectClipboard, 0, 0);
    this.floatingImage = pasted;
    this.floatingPos = {
      x: Math.round((this.canvas.width - pasted.width) / 2),
      y: Math.round((this.canvas.height - pasted.height) / 2)
    };
    this.selection = {
      x: this.floatingPos.x,
      y: this.floatingPos.y,
      w: pasted.width,
      h: pasted.height
    };
    this._selectPhase = null;
    this._renderSelectionOverlay();
    return true;
  }

  _clearSelectionOverlay() {
    const ctx = this.selectionCanvas?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.selectionCanvas.width, this.selectionCanvas.height);
  }

  _renderSelectionOverlay() {
    const ctx = this.selectionCanvas?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.selectionCanvas.width, this.selectionCanvas.height);
    if (this.floatingImage && this.floatingPos) {
      ctx.drawImage(this.floatingImage, Math.round(this.floatingPos.x), Math.round(this.floatingPos.y));
    }
    const rect = this._normalizedSelection();
    if (!rect) return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
    ctx.lineDashOffset = 5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
    ctx.restore();
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
    if (!this.isDrawing) {
      this.activeTool = tool;
    }
    log.debug('도구 변경', { tool });
  }

  /**
   * 지우개 방식 설정
   */
  setEraserMode(mode) {
    this.eraserMode = normalizeEraserMode(mode);
    if (!this.isDrawing) {
      this.activeEraserMode = this.eraserMode;
    }
    log.debug('지우개 방식 변경', { eraserMode: this.eraserMode });
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
    this.lineWidth = Math.min(50, Math.max(1, parseInt(width) || 3));
    log.debug('선 두께 변경', { width: this.lineWidth });
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
    this._endSizeAdjust();
    // AbortController를 통해 모든 이벤트 리스너 제거
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._removeSizeAdjustListeners();

    // 임시 캔버스 정리
    this.tempCanvas = null;
    this.tempCtx = null;
    this.backupImageData = null;
    this._selectClipboard = null;
    this.floatingImage = null;
    this.selectionCanvas = null;

    log.info('DrawingCanvas 정리됨');
  }
}

export default DrawingCanvas;
