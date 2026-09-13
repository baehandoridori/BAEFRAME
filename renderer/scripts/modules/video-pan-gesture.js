export function createVideoPanGesture({ canStart, getTransform, onChange, onFinish }) {
  let active = null;
  const move = e => {
    if (!active || e.pointerId !== active.pointerId || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    const dx = e.clientX - active.x;
    const dy = e.clientY - active.y;
    active.maxDistance = Math.max(active.maxDistance, Math.hypot(dx, dy));
    onChange({ panX: active.panX + dx / active.scale, panY: active.panY + dy / active.scale }, { maxDistance: active.maxDistance });
  };
  const finish = cancelled => {
    if (!active) return;
    const previous = active;
    active = null;
    try { previous.target?.releasePointerCapture?.(previous.pointerId); } catch { /* pointer already gone */ }
    onFinish?.({ cancelled, maxDistance: previous.maxDistance, pointerId: previous.pointerId });
  };
  return {
    pointerDown(e) {
      if (active || e.isPrimary === false || e.button !== 0 || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return false;
      if (e.target?.closest?.('input, textarea, select, button, [contenteditable="true"], [contenteditable="plaintext-only"], [role="slider"], [role="toolbar"], .toolbar')) return false;
      if (!canStart(e)) return false;
      const transform = getTransform();
      if (!Number.isFinite(transform.scale) || transform.scale <= 0 || !Number.isFinite(transform.panX) || !Number.isFinite(transform.panY)) return false;
      active = { ...transform, pointerId: e.pointerId, target: e.currentTarget, x: e.clientX, y: e.clientY, maxDistance: 0 };
      try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch { /* outside capture scope */ }
      e.preventDefault?.(); e.stopPropagation?.();
      return true;
    },
    pointerMove(e) {
      if (!active || e.pointerId !== active.pointerId) return;
      if (e.buttons === 0) { finish(true); return; }
      move(e);
    },
    pointerUp(e) {
      if (!active || e.pointerId !== active.pointerId) return;
      move(e); finish(false);
    },
    cancel(event) {
      if (event?.pointerId !== undefined && event.pointerId !== active?.pointerId) return;
      finish(true);
    }
  };
}
