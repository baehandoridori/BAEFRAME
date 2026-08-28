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

// 문자열은 "수식키 없는 그 코드"를, 객체는 지정된 chord 전체를 뜻한다.
// code 만 보면 Shift+E 를 우회 목록에 넣었을 때 평문 E 까지 텍스트 입력에서
// 빼앗고, 반대로 chord 배정을 빼면 그 단축키가 에디터로 새어 죽는다.
function normalizeGlobalShortcuts(value) {
  if (!value) return null;
  const entries = Array.isArray(value) ? value : [value];
  const normalized = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      if (entry.length === 0 || entry.length > 32) continue;
      normalized.push({ code: entry, ctrlKey: false, shiftKey: false, altKey: false });
      continue;
    }
    const code = entry?.code ?? entry?.key;
    if (typeof code !== 'string' || code.length === 0 || code.length > 32) continue;
    normalized.push({
      code,
      ctrlKey: entry.ctrl === true || entry.ctrlKey === true,
      shiftKey: entry.shift === true || entry.shiftKey === true,
      altKey: entry.alt === true || entry.altKey === true
    });
  }
  return normalized.length > 0 ? normalized : null;
}

function matchesGlobalShortcut(input, shortcuts) {
  if (shortcuts === null || input.metaKey === true) return false;
  return shortcuts.some(shortcut => (
    shortcut.code === input.code &&
    shortcut.ctrlKey === (input.ctrlKey === true) &&
    shortcut.shiftKey === (input.shiftKey === true) &&
    shortcut.altKey === (input.altKey === true)
  ));
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
    const shortcuts = normalizeGlobalShortcuts(globalShortcutCodes);
    const escapesTextEntry = matchesGlobalShortcut(input, shortcuts) &&
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
