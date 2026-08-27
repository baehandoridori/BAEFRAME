const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week'
]);

function getTagName(target) {
  return String(target?.tagName || '').toUpperCase();
}

function getInputType(target) {
  return String(target?.type || 'text').toLowerCase();
}

function isContentEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;

  if (typeof target.closest === 'function') {
    try {
      if (target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) {
        return true;
      }
    } catch {
      // Non-Element test doubles can expose a partial closest() shape.
    }
  }

  let node = target.parentElement;
  while (node) {
    if (node.isContentEditable) return true;
    node = node.parentElement;
  }
  return false;
}

export function isTextEntryShortcutTarget(target) {
  if (isContentEditableTarget(target)) return true;

  const tagName = getTagName(target);
  if (tagName === 'TEXTAREA') return true;
  if (tagName !== 'INPUT') return false;

  return TEXT_ENTRY_INPUT_TYPES.has(getInputType(target));
}

export function getEffectiveKeyboardShortcutTarget(event, ownerDocument = globalThis.document) {
  const target = event?.target || null;
  if (target && target === ownerDocument) return target;
  const tagName = getTagName(target);
  if (target && tagName !== 'BODY' && tagName !== 'HTML' && tagName !== '') {
    return target;
  }

  return ownerDocument?.activeElement || target;
}

export function shouldIgnoreComposingKeyboardEvent(event) {
  return event?.isComposing === true || event?.key === 'Process' || event?.code === 'Process';
}

export function shouldHandlePlayPauseShortcutFromTarget(target, event = null) {
  if (isTextEntryShortcutTarget(target)) return false;

  const tagName = getTagName(target);
  if (tagName === 'INPUT' && event?.code && event.code !== 'Space') {
    return false;
  }

  return true;
}

// 비텍스트 폼 컨트롤(range/checkbox/radio/color/button 등)과 SELECT가 실제로 소비하는 키.
// 이 목록 밖의 문자 키(KeyB/KeyC/KeyV 등)는 컨트롤이 삼키지 않으므로 전역 단축키로 흘려보낸다.
const CONTROL_CONSUMED_KEY_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Enter'
]);

export function shouldIgnoreGlobalShortcutTarget(target, event = null) {
  if (isTextEntryShortcutTarget(target)) return true;

  const tagName = getTagName(target);
  if (tagName !== 'INPUT' && tagName !== 'SELECT') return false;

  // code를 알 수 없는 호출(paste 등 비키보드 이벤트)은 기존과 동일하게 보수적으로 차단한다.
  const code = typeof event?.code === 'string' ? event.code : '';
  if (code.length === 0) return true;
  return CONTROL_CONSUMED_KEY_CODES.has(code);
}
