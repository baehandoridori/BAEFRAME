var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// shared/viewport-pan-message.js
var require_viewport_pan_message = __commonJS({
  "shared/viewport-pan-message.js"(exports, module) {
    "use strict";
    var PAN_CHANNEL = "mpv-overlay:viewport-pan";
    var PAN_COMMAND_CHANNEL = "mpv-overlay:viewport-pan-command";
    var FENCE_KEYS = ["gestureId", "sequence", "pointerId", "hostGeneration", "videoGeneration", "persistenceSessionId", "stableVideoIdentity"];
    var SESSION_KEYS = ["hostGeneration", "videoGeneration", "persistenceSessionId", "stableVideoIdentity"];
    function exact(value, keys) {
      if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
      const own = Reflect.ownKeys(value);
      return own.length === keys.length && own.every((key) => keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.get === void 0);
    }
    function boundedString(value, max) {
      return typeof value === "string" && value.length > 0 && value.length <= max;
    }
    function fenceValid(value) {
      return ["sequence", "pointerId", "hostGeneration", "videoGeneration"].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0) && boundedString(value.gestureId, 256) && boundedString(value.persistenceSessionId, 32768) && boundedString(value.stableVideoIdentity, 32768);
    }
    function normalizeViewportPanMessage(value) {
      if (!exact(value, [...FENCE_KEYS, "phase", "clientX", "clientY"]) || !fenceValid(value) || !["start", "move", "end", "cancel"].includes(value.phase) || (value.phase === "start" ? value.sequence !== 0 : value.sequence < 1) || !["clientX", "clientY"].every((key) => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e6)) return null;
      return { ...value };
    }
    function normalizeViewportPanCommand(value) {
      const extra = value?.type === "decision" ? ["disposition", "transform"] : value?.type === "ack" ? ["transform"] : [];
      if (!exact(value, [...FENCE_KEYS, "type", ...extra]) || !fenceValid(value) || !["decision", "ack", "flush", "cancel"].includes(value.type)) return null;
      if (value.type === "decision" && !["pan", "draw", "blocked"].includes(value.disposition)) return null;
      if (extra.includes("transform")) {
        const t = value.transform;
        if (!exact(t, ["scale", "panX", "panY"]) || !Object.values(t).every(Number.isFinite) || t.scale < 0.25 || t.scale > 8) return null;
        return { ...value, transform: { ...t } };
      }
      return { ...value };
    }
    function samePanSession(a, b) {
      return !!a && !!b && SESSION_KEYS.every((key) => a[key] === b[key]);
    }
    function samePanGesture(a, b) {
      return samePanSession(a, b) && a.gestureId === b.gestureId && a.pointerId === b.pointerId;
    }
    function panCommandFields(value) {
      return Object.fromEntries(FENCE_KEYS.map((key) => [key, value[key]]));
    }
    module.exports = { PAN_CHANNEL, PAN_COMMAND_CHANNEL, normalizeViewportPanMessage, normalizeViewportPanCommand, samePanSession, samePanGesture, panCommandFields };
  }
});

// shared/viewport-pan-controller.js
var require_viewport_pan_controller = __commonJS({
  "shared/viewport-pan-controller.js"(exports, module) {
    var { normalizeViewportPanMessage, normalizeViewportPanCommand, samePanSession, samePanGesture, panCommandFields } = require_viewport_pan_message();
    function translate(start, point, transform) {
      return { scale: transform.scale, panX: transform.panX + (point.clientX - start.clientX) / transform.scale, panY: transform.panY + (point.clientY - start.clientY) / transform.scale };
    }
    function createViewportPanOwner(options) {
      const schedule = options.setTimeout || setTimeout, clear = options.clearTimeout || clearTimeout;
      let active = null, cycle = null, timer = null, mirror = null;
      const stopTimer = () => {
        if (timer !== null) clear(timer);
        timer = null;
      };
      const send = (type, extra = {}) => {
        if (!active) return false;
        try {
          return options.send({ ...panCommandFields(active.last), type, ...extra }) === true;
        } catch {
          return false;
        }
      };
      const finishCycle = () => {
        const previous = cycle;
        cycle = null;
        if (previous?.released && previous.tapAllowed && !previous.consumed) options.togglePlayback();
      };
      const cancel = () => {
        if (cycle) cycle.consumed = true;
        send("cancel");
        active = null;
        stopTimer();
        cycle = null;
      };
      const arm = (ms = 1e4) => {
        stopTimer();
        timer = schedule(cancel, ms);
      };
      return {
        keyDown({ tapAllowed = false, repeat = false, drawing = false } = {}) {
          if (repeat || cycle) return;
          cycle = { tapAllowed, consumed: drawing || active?.disposition === "draw", released: false };
        },
        keyUp() {
          if (!cycle || cycle.released) return;
          cycle.released = true;
          if (active?.disposition === "pan") {
            arm(750);
            if (!send("flush")) cancel();
          } else finishCycle();
        },
        consume() {
          if (cycle) cycle.consumed = true;
        },
        message(value) {
          const message = normalizeViewportPanMessage(value);
          if (!message || !samePanSession(message, options.getFence())) return false;
          if (message.phase === "start") {
            if (active) return false;
            const disposition = cycle && !cycle.released ? options.canPan() ? "pan" : "blocked" : "draw";
            active = { start: message, last: message, transform: { ...options.getTransform() }, disposition };
            if (disposition === "blocked" && cycle) cycle.consumed = true;
            if (disposition !== "draw") arm();
            if (!send("decision", { disposition, transform: active.transform })) cancel();
            if (active?.disposition === "blocked") {
              active = null;
              stopTimer();
            }
            return true;
          }
          if (!active || !samePanGesture(message, active.last) || message.sequence <= active.last.sequence) return false;
          active.last = message;
          if (message.phase === "cancel") {
            cancel();
            return true;
          }
          if (active.disposition === "pan") {
            if (Math.hypot(message.clientX - active.start.clientX, message.clientY - active.start.clientY) >= 3 && cycle) cycle.consumed = true;
            const transform = translate(active.start, message, active.transform);
            mirror = { gestureId: message.gestureId, sequence: message.sequence };
            options.applyTransform(transform);
            if (!send("ack", { transform })) {
              cancel();
              return false;
            }
          }
          if (message.phase === "end") {
            active = null;
            stopTimer();
            if (cycle?.released) finishCycle();
          } else if (active.disposition === "pan") arm();
          return true;
        },
        cancel,
        getMirror: () => mirror && { ...mirror },
        isHeld: () => !!cycle && !cycle.released,
        isPending: () => !!active,
        isConsumed: () => cycle?.consumed === true
      };
    }
    var SNAPSHOT_FIELDS = ["type", "pointerId", "pointerType", "isPrimary", "button", "buttons", "clientX", "clientY", "pressure", "tiltX", "tiltY", "twist", "width", "height", "timeStamp", "ctrlKey", "altKey", "shiftKey", "metaKey"];
    function createViewportPanInput(options) {
      const schedule = options.setTimeout || setTimeout, clear = options.clearTimeout || clearTimeout;
      const raf = options.requestAnimationFrame || ((cb) => schedule(cb, 16)), caf = options.cancelAnimationFrame || clear;
      let active = null, retired = null, timer = null, frame = null;
      const stop = (event) => {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        event.stopPropagation?.();
      };
      const snapshot = (event) => Object.fromEntries(SNAPSHOT_FIELDS.filter((key) => event[key] !== void 0).map((key) => [key, event[key]]));
      const clearTimer = () => {
        if (timer !== null) clear(timer);
        timer = null;
      };
      const clearFrame = () => {
        if (frame !== null) caf(frame);
        frame = null;
      };
      const send = (phase) => {
        if (!active) return false;
        if (phase !== "start") active.sequence++;
        const message = { ...active.fence, gestureId: active.id, sequence: active.sequence, pointerId: active.pointerId, phase, clientX: active.latest.clientX, clientY: active.latest.clientY };
        if (!normalizeViewportPanMessage(message)) return false;
        try {
          return options.send(message) === true;
        } catch {
          return false;
        }
      };
      const release = () => {
        const previous = active;
        active = null;
        clearTimer();
        clearFrame();
        if (previous?.disposition === "pan") retired = { gestureId: previous.id, sequence: previous.sequence };
        try {
          previous?.target?.releasePointerCapture?.(previous.pointerId);
        } catch {
        }
      };
      const cancel = () => {
        if (!active) return;
        send("cancel");
        release();
      };
      const flushMove = () => {
        clearFrame();
        if (active?.dirty) {
          active.dirty = false;
          const latest = active.latest;
          if (active.excursion) active.latest = active.excursion;
          active.excursion = null;
          if (!send("move")) {
            cancel();
            return;
          }
          if (active) {
            const sentPoint = active.latest;
            active.latest = latest;
            active.dirty = sentPoint.clientX !== latest.clientX || sentPoint.clientY !== latest.clientY;
            if (active.dirty && frame === null) frame = raf(() => {
              frame = null;
              flushMove();
            });
          }
        }
      };
      const update = (event) => {
        if (!active) return;
        const distance = Math.hypot(event.clientX - active.start.clientX, event.clientY - active.start.clientY);
        if (distance >= 3 && !active.consumed) {
          active.excursion = snapshot(event);
          active.consumed = true;
        }
        active.latest = snapshot(event);
        active.dirty = true;
        options.applyTransform(translate(active.start, event, active.transform));
        if (frame === null) frame = raf(() => {
          frame = null;
          flushMove();
        });
      };
      const end = () => {
        flushMove();
        if (active) {
          send("end");
          release();
        }
      };
      const api = {
        down(event) {
          if (active || event.button !== 0 || event.isPrimary === false) return false;
          const fence = options.getFence();
          const id = options.createId();
          if (!normalizeViewportPanMessage({ ...fence, gestureId: id, sequence: 0, pointerId: event.pointerId, phase: "start", clientX: event.clientX, clientY: event.clientY })) {
            stop(event);
            return true;
          }
          active = { fence, id, sequence: 0, pointerId: event.pointerId, target: event.currentTarget || options.getTarget?.(), start: snapshot(event), latest: snapshot(event), events: [snapshot(event)], disposition: "pending", dirty: false, consumed: false };
          try {
            active.target?.setPointerCapture?.(event.pointerId);
          } catch {
          }
          stop(event);
          timer = schedule(cancel, 750);
          if (!send("start")) cancel();
          return true;
        },
        event(event) {
          if (!active || event.pointerId !== active.pointerId) return false;
          if (active.disposition === "draw") {
            if (event.type === "pointerup") {
              active.latest = snapshot(event);
              send("end");
              release();
            }
            return false;
          }
          stop(event);
          if (active.disposition === "pending") {
            if (active.events.length >= 4096) {
              cancel();
              return true;
            }
            if (active.events.at(-1)?.type !== "pointerup") active.events.push(snapshot(event));
            return true;
          }
          if (event.type === "pointermove" && event.buttons === 0) {
            cancel();
            return true;
          }
          update(event);
          if (event.type === "pointerup") end();
          return true;
        },
        command(value) {
          const command = normalizeViewportPanCommand(value);
          if (!command || !active || !samePanSession(command, options.getFence()) || !samePanGesture(command, { ...active.fence, gestureId: active.id, pointerId: active.pointerId })) return false;
          if (command.type === "cancel") {
            release();
            return true;
          }
          if (command.type === "decision") {
            if (active.disposition !== "pending" || command.sequence !== 0) return false;
            clearTimer();
            if (command.disposition === "blocked") {
              release();
              return true;
            }
            const events = active.events;
            active.events = [];
            active.disposition = command.disposition;
            active.transform = command.transform;
            if (command.disposition === "draw") {
              options.replay(events, active.target);
            } else {
              for (const event of events.slice(1)) {
                if (!active) break;
                api.event(event);
              }
            }
            return true;
          }
          if (command.type === "flush") {
            if (active.disposition !== "pan") {
              cancel();
              return true;
            }
            end();
            return true;
          }
          if (command.type === "ack" && command.sequence === active.sequence && !active.dirty) return true;
          return false;
        },
        cancel(event) {
          if (event?.pointerId !== void 0 && event.pointerId !== active?.pointerId) return false;
          if (event?.type === "lostpointercapture" && active?.disposition === "pending" && active.events.some((e) => e.type === "pointerup")) return true;
          const owned = !!active;
          cancel();
          return owned;
        },
        acceptsMirror(tag) {
          const guard = active?.disposition === "pan" ? { gestureId: active.id, sequence: active.sequence } : retired;
          if (!guard) return true;
          return !!tag && tag.gestureId === guard.gestureId && tag.sequence >= guard.sequence && !active?.dirty;
        },
        reset() {
          cancel();
          retired = null;
        },
        isActive: () => !!active,
        isPan: () => active?.disposition === "pan"
      };
      return api;
    }
    module.exports = { createViewportPanOwner, createViewportPanInput };
  }
});
export default require_viewport_pan_controller();
