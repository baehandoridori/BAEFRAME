export function getTimelineFocalContentX(options = {}) {
  const clientX = Number(options.clientX) || 0;
  const viewportLeft = Number(options.viewportLeft) || 0;
  const scrollLeft = Number(options.scrollLeft) || 0;
  return Math.max(0, clientX - viewportLeft + scrollLeft);
}

export function calculateAnchoredScrollLeft(options = {}) {
  const focalContentX = Math.max(0, Number(options.focalContentX) || 0);
  const viewportX = Number(options.viewportX) || 0;
  const oldZoom = Math.max(1, Number(options.oldZoom) || 100);
  const newZoom = Math.max(1, Number(options.newZoom) || oldZoom);
  const minScrollLeft = Number.isFinite(options.minScrollLeft) ? Number(options.minScrollLeft) : 0;
  const maxScrollLeft = Number.isFinite(options.maxScrollLeft) ? Number(options.maxScrollLeft) : Infinity;

  const oldScale = oldZoom / 100;
  const newScale = newZoom / 100;
  const newFocalX = (focalContentX / oldScale) * newScale;
  const scrollLeft = newFocalX - viewportX;

  return Math.max(minScrollLeft, Math.min(maxScrollLeft, scrollLeft));
}
