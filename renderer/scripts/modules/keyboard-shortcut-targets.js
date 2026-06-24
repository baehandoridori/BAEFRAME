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

export function shouldIgnoreGlobalShortcutTarget(target) {
  if (isTextEntryShortcutTarget(target)) return true;

  const tagName = getTagName(target);
  return tagName === 'INPUT' || tagName === 'SELECT';
}
