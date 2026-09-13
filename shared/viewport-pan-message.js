'use strict';

const PAN_CHANNEL = 'mpv-overlay:viewport-pan';
const PAN_COMMAND_CHANNEL = 'mpv-overlay:viewport-pan-command';
const FENCE_KEYS = ['gestureId', 'sequence', 'pointerId', 'hostGeneration', 'videoGeneration', 'persistenceSessionId', 'stableVideoIdentity'];
const SESSION_KEYS = ['hostGeneration', 'videoGeneration', 'persistenceSessionId', 'stableVideoIdentity'];
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined);
}
function boundedString(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function fenceValid(value) {
  return ['sequence', 'pointerId', 'hostGeneration', 'videoGeneration'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) &&
    boundedString(value.gestureId, 256) && boundedString(value.persistenceSessionId, 32768) && boundedString(value.stableVideoIdentity, 32768);
}
function normalizeViewportPanMessage(value) {
  if (!exact(value, [...FENCE_KEYS, 'phase', 'clientX', 'clientY']) || !fenceValid(value) ||
      !['start', 'move', 'end', 'cancel'].includes(value.phase) ||
      (value.phase === 'start' ? value.sequence !== 0 : value.sequence < 1) ||
      !['clientX', 'clientY'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1000000)) return null;
  return { ...value };
}
function normalizeViewportPanCommand(value) {
  const extra = value?.type === 'decision' ? ['disposition', 'transform'] : value?.type === 'ack' ? ['transform'] : [];
  if (!exact(value, [...FENCE_KEYS, 'type', ...extra]) || !fenceValid(value) || !['decision', 'ack', 'flush', 'cancel'].includes(value.type)) return null;
  if (value.type === 'decision' && !['pan', 'draw', 'blocked'].includes(value.disposition)) return null;
  if (extra.includes('transform')) {
    const t = value.transform;
    if (!exact(t, ['scale', 'panX', 'panY']) || !Object.values(t).every(Number.isFinite) || t.scale < 0.25 || t.scale > 8) return null;
    return { ...value, transform: { ...t } };
  }
  return { ...value };
}
function samePanSession(a, b) { return !!a && !!b && SESSION_KEYS.every(key => a[key] === b[key]); }
function samePanGesture(a, b) { return samePanSession(a, b) && a.gestureId === b.gestureId && a.pointerId === b.pointerId; }
function panCommandFields(value) { return Object.fromEntries(FENCE_KEYS.map(key => [key, value[key]])); }
module.exports = { PAN_CHANNEL, PAN_COMMAND_CHANNEL, normalizeViewportPanMessage, normalizeViewportPanCommand, samePanSession, samePanGesture, panCommandFields };
