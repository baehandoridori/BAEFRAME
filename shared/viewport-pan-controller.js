'use strict';
const { normalizeViewportPanMessage, normalizeViewportPanCommand, samePanSession, samePanGesture, panCommandFields } = require('./viewport-pan-message');

function translate(start, point, transform) {
  return { scale: transform.scale, panX: transform.panX + (point.clientX - start.clientX) / transform.scale, panY: transform.panY + (point.clientY - start.clientY) / transform.scale };
}
function createViewportPanOwner(options) {
  const schedule = options.setTimeout || setTimeout, clear = options.clearTimeout || clearTimeout;
  let active = null, cycle = null, timer = null, mirror = null;
  const stopTimer = () => { if (timer !== null) clear(timer); timer = null; };
  const send = (type, extra = {}) => {
    if (!active) return false;
    try { return options.send({ ...panCommandFields(active.last), type, ...extra }) === true; } catch { return false; }
  };
  const finishCycle = () => {
    const previous = cycle; cycle = null;
    if (previous?.released && previous.tapAllowed && !previous.consumed) options.togglePlayback();
  };
  const cancel = (terminalTransform = null) => {
    if (cycle) cycle.consumed = true;
    if (active?.disposition === 'pan') {
      mirror = { gestureId: active.last.gestureId, sequence: active.last.sequence };
      options.applyTransform(terminalTransform || options.getTransform());
    }
    send('cancel', { transform: { ...options.getTransform() } }); active = null; stopTimer();
    cycle = null;
  };
  const arm = (ms = 10000) => { stopTimer(); timer = schedule(cancel, ms); };
  return {
    keyDown({ tapAllowed = false, repeat = false, drawing = false } = {}) {
      if (repeat || cycle) return;
      cycle = { tapAllowed, consumed: drawing || active?.disposition === 'draw', released: false };
    },
    keyUp() {
      if (!cycle || cycle.released) return;
      cycle.released = true;
      if (active?.disposition === 'pan') {
        arm(750); if (!send('flush')) cancel();
      } else finishCycle();
    },
    consume() { if (cycle) cycle.consumed = true; },
    message(value) {
      const message = normalizeViewportPanMessage(value);
      if (!message || !samePanSession(message, options.getFence())) return false;
      if (message.phase === 'start') {
        if (active) return false;
        const disposition = cycle && !cycle.released ? (options.canPan() ? 'pan' : 'blocked') : 'draw';
        active = { start: message, last: message, transform: { ...options.getTransform() }, disposition };
        if (disposition === 'blocked' && cycle) cycle.consumed = true;
        if (disposition !== 'draw') arm();
        if (!send('decision', { disposition, transform: active.transform })) cancel();
        // send can synchronously resolve buffered up in tests. Do not revive a finished gesture.
        if (active?.disposition === 'blocked') { active = null; stopTimer(); }
        return true;
      }
      if (!active || !samePanGesture(message, active.last) || message.sequence <= active.last.sequence) return false;
      active.last = message;
      if (message.phase === 'cancel') {
        cancel(active.disposition === 'pan' ? translate(active.start, message, active.transform) : null);
        return true;
      }
      if (active.disposition === 'pan') {
        if (Math.hypot(message.clientX - active.start.clientX, message.clientY - active.start.clientY) >= 3 && cycle) cycle.consumed = true;
        const transform = translate(active.start, message, active.transform);
        mirror = { gestureId: message.gestureId, sequence: message.sequence };
        options.applyTransform(transform);
        if (!send('ack', { transform })) { cancel(); return false; }
      }
      if (message.phase === 'end') {
        active = null; stopTimer();
        if (cycle?.released) finishCycle();
      } else if (active.disposition === 'pan') arm();
      return true;
    },
    cancel,
    getMirror: () => mirror && { ...mirror },
    isHeld: () => !!cycle && !cycle.released,
    isPending: () => !!active,
    isConsumed: () => cycle?.consumed === true
  };
}

const SNAPSHOT_FIELDS = ['type', 'pointerId', 'pointerType', 'isPrimary', 'button', 'buttons', 'clientX', 'clientY', 'pressure', 'tiltX', 'tiltY', 'twist', 'width', 'height', 'timeStamp', 'ctrlKey', 'altKey', 'shiftKey', 'metaKey'];
function createViewportPanInput(options) {
  const schedule = options.setTimeout || setTimeout, clear = options.clearTimeout || clearTimeout;
  const raf = options.requestAnimationFrame || (cb => schedule(cb, 16)), caf = options.cancelAnimationFrame || clear;
  let active = null, retired = null, timer = null, frame = null;
  const stop = event => { event.preventDefault?.(); event.stopImmediatePropagation?.(); event.stopPropagation?.(); };
  const snapshot = event => Object.fromEntries(SNAPSHOT_FIELDS.filter(key => event[key] !== undefined).map(key => [key, event[key]]));
  const clearTimer = () => { if (timer !== null) clear(timer); timer = null; };
  const clearFrame = () => { if (frame !== null) caf(frame); frame = null; };
  const send = phase => {
    if (!active) return false;
    if (phase !== 'start') active.sequence++;
    const message = { ...active.fence, gestureId: active.id, sequence: active.sequence, pointerId: active.pointerId, phase, clientX: active.latest.clientX, clientY: active.latest.clientY };
    if (!normalizeViewportPanMessage(message)) return false;
    try { return options.send(message) === true; } catch { return false; }
  };
  const release = () => {
    const previous = active; active = null; clearTimer(); clearFrame();
    if (previous?.disposition === 'pan') retired = { ...previous.fence, gestureId: previous.id, pointerId: previous.pointerId, sequence: previous.sequence };
    try { previous?.target?.releasePointerCapture?.(previous.pointerId); } catch { /* capture may already be gone */ }
  };
  const cancel = () => { if (!active) return; send('cancel'); release(); };
  const flushMove = () => {
    clearFrame();
    if (active?.dirty) {
      active.dirty = false;
      const latest = active.latest;
      if (active.excursion) active.latest = active.excursion;
      active.excursion = null;
      if (!send('move')) { cancel(); return; }
      if (active) {
        const sentPoint = active.latest;
        active.latest = latest;
        active.dirty = sentPoint.clientX !== latest.clientX || sentPoint.clientY !== latest.clientY;
        if (active.dirty && frame === null) frame = raf(() => { frame = null; flushMove(); });
      }
    }
  };
  const update = event => {
    if (!active) return;
    // Preserve the maximum excursion even when rAF coalesces a return to the origin.
    const distance = Math.hypot(event.clientX - active.start.clientX, event.clientY - active.start.clientY);
    if (distance >= 3 && !active.consumed) {
      active.excursion = snapshot(event); active.consumed = true;
    }
    active.latest = snapshot(event); active.dirty = true;
    options.applyTransform(translate(active.start, event, active.transform));
    if (frame === null) frame = raf(() => { frame = null; flushMove(); });
  };
  const end = () => { flushMove(); if (active) { send('end'); release(); } };
  const api = {
    down(event) {
      if (active || event.button !== 0 || event.isPrimary === false) return false;
      const fence = options.getFence();
      const id = options.createId();
      if (!normalizeViewportPanMessage({ ...fence, gestureId: id, sequence: 0, pointerId: event.pointerId, phase: 'start', clientX: event.clientX, clientY: event.clientY })) { stop(event); return true; }
      active = { fence, id, sequence: 0, pointerId: event.pointerId, target: event.currentTarget || options.getTarget?.(), start: snapshot(event), latest: snapshot(event), events: [snapshot(event)], disposition: 'pending', dirty: false, consumed: false };
      try { active.target?.setPointerCapture?.(event.pointerId); } catch { /* best effort */ }
      stop(event);
      timer = schedule(cancel, 750);
      if (!send('start')) cancel();
      return true;
    },
    event(event) {
      if (!active || event.pointerId !== active.pointerId) return false;
      if (active.disposition === 'draw') {
        if (event.type === 'pointerup') { active.latest = snapshot(event); send('end'); release(); }
        return false;
      }
      stop(event);
      if (active.disposition === 'pending') {
        if (active.events.length >= 4096) { cancel(); return true; }
        if (active.events.at(-1)?.type !== 'pointerup') active.events.push(snapshot(event));
        return true;
      }
      if (event.type === 'pointermove' && event.buttons === 0) { cancel(); return true; }
      update(event);
      if (event.type === 'pointerup') end();
      return true;
    },
    command(value) {
      const command = normalizeViewportPanCommand(value);
      if (!command || !samePanSession(command, options.getFence())) return false;
      if (!active) {
        if (command.type !== 'cancel' || !retired || !samePanGesture(command, retired)) return false;
        options.applyTransform(command.transform);
        retired.sequence = command.sequence;
        return true;
      }
      if (!samePanGesture(command, { ...active.fence, gestureId: active.id, pointerId: active.pointerId })) return false;
      if (command.type === 'cancel') {
        if (active.disposition === 'pan') options.applyTransform(command.transform);
        active.sequence = command.sequence;
        release(); return true;
      }
      if (command.type === 'decision') {
        if (active.disposition !== 'pending' || command.sequence !== 0) return false;
        clearTimer();
        if (command.disposition === 'blocked') { release(); return true; }
        const events = active.events; active.events = [];
        active.disposition = command.disposition; active.transform = command.transform;
        if (command.disposition === 'draw') {
          options.replay(events, active.target);
        } else {
          for (const event of events.slice(1)) { if (!active) break; api.event(event); }
        }
        return true;
      }
      if (command.type === 'flush') {
        if (active.disposition !== 'pan') { cancel(); return true; }
        end(); return true;
      }
      // A local unsent move is newer than every ack, even an ack of the last transmitted sequence.
      if (command.type === 'ack' && command.sequence === active.sequence && !active.dirty) return true;
      return false;
    },
    cancel(event) {
      if (event?.pointerId !== undefined && event.pointerId !== active?.pointerId) return false;
      if (event?.type === 'lostpointercapture' && active?.disposition === 'pending' && active.events.some(e => e.type === 'pointerup')) return true;
      const owned = !!active; cancel(); return owned;
    },
    acceptsMirror(tag) {
      const guard = active?.disposition === 'pan' ? { gestureId: active.id, sequence: active.sequence } : retired;
      if (!guard) return true;
      return !!tag && tag.gestureId === guard.gestureId && tag.sequence >= guard.sequence && !active?.dirty;
    },
    reset() { cancel(); retired = null; },
    isActive: () => !!active,
    isPan: () => active?.disposition === 'pan'
  };
  return api;
}
module.exports = { createViewportPanOwner, createViewportPanInput };
