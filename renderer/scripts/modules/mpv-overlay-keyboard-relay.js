import { isTextEntryShortcutTarget } from './keyboard-shortcut-targets.js';

const NAMED_KEY_CODES = new Set([
  'Backspace', 'Tab', 'Enter', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'Escape', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backquote',
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'CapsLock', 'Semicolon',
  'Quote', 'Comma', 'Period', 'Slash', 'PrintScreen', 'ScrollLock', 'Pause', 'NumLock',
  'ContextMenu', 'IntlBackslash', 'IntlRo', 'IntlYen', 'Convert', 'NonConvert', 'KanaMode',
  'Lang1', 'Lang2', 'Lang3', 'Lang4', 'Lang5', 'Help', 'Again', 'Undo', 'Cut', 'Copy',
  'Paste', 'Find', 'Props', 'Select', 'Open', 'Eject', 'Power', 'WakeUp', 'BrowserBack',
  'BrowserForward', 'BrowserRefresh', 'BrowserStop', 'BrowserSearch', 'BrowserFavorites',
  'BrowserHome', 'AudioVolumeMute', 'AudioVolumeDown', 'AudioVolumeUp', 'MediaTrackNext',
  'MediaTrackPrevious', 'MediaStop', 'MediaPlayPause', 'MediaSelect', 'LaunchMail',
  'LaunchApp1', 'LaunchApp2'
]);
const KEYBOARD_INPUT_FIELDS = new Set([
  'type', 'key', 'code', 'shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'repeat'
]);

function isPhysicalKeyCode(code) {
  if (typeof code !== 'string' || code.length === 0 || code.length > 32) return false;
  if (/^Key[A-Z]$/.test(code) ||
      /^Digit[0-9]$/.test(code) ||
      /^F(?:[1-9]|1\d|2[0-4])$/.test(code) ||
      /^Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma|ParenLeft|ParenRight|Backspace|Clear|ClearEntry|MemoryAdd|MemoryClear|MemoryRecall|MemoryStore|MemorySubtract)$/.test(code)) {
    return true;
  }
  return NAMED_KEY_CODES.has(code);
}

function normalizeKeyboardInput(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const fields = Object.keys(value);
    if (fields.length !== KEYBOARD_INPUT_FIELDS.size ||
        fields.some(field => !KEYBOARD_INPUT_FIELDS.has(field))) {
      return null;
    }
    if (value.type !== 'keyDown' && value.type !== 'keyUp') return null;
    if (typeof value.key !== 'string' ||
        value.key.length === 0 ||
        value.key.length > 64 ||
        value.key.includes('\u0000') ||
        ['Process', 'Dead', 'Unidentified'].includes(value.key) ||
        !isPhysicalKeyCode(value.code) ||
        ['Process', 'Dead', 'Unidentified'].includes(value.code) ||
        typeof value.shiftKey !== 'boolean' ||
        typeof value.ctrlKey !== 'boolean' ||
        typeof value.altKey !== 'boolean' ||
        typeof value.metaKey !== 'boolean' ||
        typeof value.repeat !== 'boolean') {
      return null;
    }
    return {
      type: value.type,
      key: value.key,
      code: value.code,
      shiftKey: value.shiftKey,
      ctrlKey: value.ctrlKey,
      altKey: value.altKey,
      metaKey: value.metaKey,
      repeat: value.repeat
    };
  } catch (_error) {
    return null;
  }
}

function isOverlayHistoryShortcut(input) {
  if (input.type !== 'keyDown' || input.altKey === true) return false;
  const exactlyOnePrimaryModifier = input.ctrlKey !== input.metaKey;
  if (!exactlyOnePrimaryModifier) return false;
  if (input.code === 'KeyZ') return true;
  return input.code === 'KeyY' && input.shiftKey !== true;
}

function normalizeGlobalShortcutCodes(value) {
  if (!value) return null;
  const codes = Array.isArray(value) ? value : [value];
  const normalized = new Set();
  for (const code of codes) {
    if (typeof code === 'string' && code.length > 0 && code.length <= 32) normalized.add(code);
  }
  return normalized.size > 0 ? normalized : null;
}

export function dispatchMpvOverlayKeyboardInput(
  value,
  {
    ownerDocument = globalThis.document,
    KeyboardEventConstructor = globalThis.KeyboardEvent,
    globalShortcutCodes = null
  } = {}
) {
  const input = normalizeKeyboardInput(value);
  if (!input ||
      typeof ownerDocument?.dispatchEvent !== 'function' ||
      typeof KeyboardEventConstructor !== 'function') {
    return false;
  }

  try {
    const event = new KeyboardEventConstructor(
      input.type === 'keyDown' ? 'keydown' : 'keyup',
      {
        key: input.key,
        code: input.code,
        shiftKey: input.shiftKey,
        ctrlKey: input.ctrlKey,
        altKey: input.altKey,
        metaKey: input.metaKey,
        repeat: input.repeat,
        bubbles: true,
        cancelable: true,
        composed: false
      }
    );
    const activeElement = ownerDocument.activeElement;
    // 메인 창에 남아 있던 텍스트 입력 포커스가 오버레이에서 릴레이된 전역 단축키를
    // 삼키지 않게 한다. body로 보내면 getEffectiveKeyboardShortcutTarget이 다시
    // activeElement로 되돌아가므로(BODY 폴백), 히스토리 chord와 같이 document로 보낸다.
    const shortcutCodes = normalizeGlobalShortcutCodes(globalShortcutCodes);
    const escapesTextEntry = shortcutCodes !== null &&
      shortcutCodes.has(input.code) &&
      isTextEntryShortcutTarget(activeElement);
    const dispatchTarget = !isOverlayHistoryShortcut(input) &&
        !escapesTextEntry &&
        typeof activeElement?.dispatchEvent === 'function'
      ? activeElement
      : ownerDocument;
    dispatchTarget.dispatchEvent(event);
    return true;
  } catch (_error) {
    return false;
  }
}
