/**
 * Display surface for raster drawings saved by older BAEFRAME versions.
 * Input and authoring belong to the current drawing engine. This surface never
 * subscribes to pointer/keyboard events or changes the saved drawing records.
 */
export class LegacyDrawingDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  syncSize(width, height) {
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }

  destroy() {
    this.clear();
  }
}

export default LegacyDrawingDisplay;
