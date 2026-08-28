'use strict';

// mpv 오버레이 창(BrowserWindow) 안에서 fabric 드로잉을 조작하는 드래그형 팔레트 셸.
// 레거시 renderer/index.html #drawingTools + renderer/styles/main.css .drawing-tools
// 디자인(헤더 드래그 핸들 + 접기 버튼 + 세로 섹션)을 그대로 계승한다.
// 도구 버튼·브러시 설정·선택 설정 엘리먼트는 런타임이 만들어 sections로 넘겨 준다.

const PALETTE_STORAGE_KEY = 'baeframe.mpvFabricPalette.v1';
const PALETTE_MARGIN = 12;
const PALETTE_FALLBACK_WIDTH = 220;
const PALETTE_FALLBACK_HEIGHT = 120;
const DEFAULT_PALETTE_STATE = Object.freeze({
  left: PALETTE_MARGIN,
  top: PALETTE_MARGIN,
  collapsed: false
});

const DRAG_HANDLE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>';
const COLLAPSE_ICON_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

// 오버레이 문서는 data: URL 오리진이라 localStorage 접근이 예외를 던질 수 있다.
// 창별 메모리 캐시를 항상 함께 유지해 최소한 같은 창 안에서는 위치가 보존되게 한다.
const memoryPaletteStates = new WeakMap();
let detachedPaletteState = { ...DEFAULT_PALETTE_STATE };

function finitePaletteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePaletteState(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PALETTE_STATE };
  return {
    left: finitePaletteNumber(value.left, DEFAULT_PALETTE_STATE.left),
    top: finitePaletteNumber(value.top, DEFAULT_PALETTE_STATE.top),
    collapsed: value.collapsed === true
  };
}

function readMemoryPaletteState(windowRef) {
  if (!windowRef || typeof windowRef !== 'object') return { ...detachedPaletteState };
  const stored = memoryPaletteStates.get(windowRef);
  return stored ? { ...stored } : { ...DEFAULT_PALETTE_STATE };
}

function writeMemoryPaletteState(windowRef, state) {
  if (!windowRef || typeof windowRef !== 'object') {
    detachedPaletteState = { ...state };
    return;
  }
  memoryPaletteStates.set(windowRef, { ...state });
}

function readStoredPaletteState(windowRef) {
  let state = normalizePaletteState(readMemoryPaletteState(windowRef));
  try {
    const raw = windowRef?.localStorage?.getItem?.(PALETTE_STORAGE_KEY);
    if (typeof raw === 'string' && raw.length > 0) {
      state = normalizePaletteState(JSON.parse(raw));
    }
  } catch (_error) {
    // data: 오리진·저장소 차단 환경에서는 메모리 캐시만 쓴다
  }
  writeMemoryPaletteState(windowRef, state);
  return { ...state };
}

function writeStoredPaletteState(windowRef, state) {
  const normalized = normalizePaletteState(state);
  writeMemoryPaletteState(windowRef, normalized);
  try {
    windowRef?.localStorage?.setItem?.(
      PALETTE_STORAGE_KEY,
      JSON.stringify(normalized)
    );
  } catch (_error) {
    // 저장에 실패해도 팔레트 조작은 계속되어야 한다
  }
  return { ...normalized };
}

function readPaletteViewport(windowRef) {
  return {
    width: finitePaletteNumber(windowRef?.innerWidth, 0),
    height: finitePaletteNumber(windowRef?.innerHeight, 0)
  };
}

function clampPalettePosition(position, viewport, size) {
  const maxLeft = Math.max(PALETTE_MARGIN, viewport.width - size.width - PALETTE_MARGIN);
  const maxTop = Math.max(PALETTE_MARGIN, viewport.height - size.height - PALETTE_MARGIN);
  return {
    left: Math.min(Math.max(PALETTE_MARGIN, position.left), maxLeft),
    top: Math.min(Math.max(PALETTE_MARGIN, position.top), maxTop)
  };
}

function createFabricDrawingPalette(options = {}) {
  const {
    documentRef,
    windowRef = null,
    element,
    setStyles,
    addDomListener,
    sections = []
  } = options;
  if (!documentRef?.createElement || !element) {
    throw new Error('Fabric palette requires a document and a root element');
  }

  const applyStyles = typeof setStyles === 'function'
    ? setStyles
    : (target, styles) => {
      if (target?.style) Object.assign(target.style, styles);
    };
  const listen = typeof addDomListener === 'function'
    ? addDomListener
    : (target, type, listener) => target?.addEventListener?.(type, listener);

  let state = readStoredPaletteState(windowRef);
  let dragOrigin = null;
  let dragPointerId = null;

  applyStyles(element, {
    position: 'absolute',
    left: `${state.left}px`,
    top: `${state.top}px`,
    zIndex: '2',
    pointerEvents: 'none'
  });

  const header = documentRef.createElement('div');
  header.className = 'mpv-fabric-pilot-toolbar-header';
  header.dataset.fabricPilotDragHandle = 'true';

  const handle = documentRef.createElement('span');
  handle.className = 'mpv-fabric-pilot-toolbar-handle';
  handle.innerHTML = DRAG_HANDLE_SVG;
  handle.setAttribute?.('aria-hidden', 'true');
  handle.setAttribute?.('title', '드래그하여 이동');

  const title = documentRef.createElement('span');
  title.className = 'mpv-fabric-pilot-toolbar-title';
  title.textContent = '그리기 도구';

  const collapseButton = documentRef.createElement('button');
  collapseButton.type = 'button';
  collapseButton.className = 'mpv-fabric-pilot-collapse-button';
  collapseButton.dataset.fabricPilotAction = 'toggle-collapse';
  collapseButton.innerHTML = COLLAPSE_ICON_SVG;
  collapseButton.setAttribute?.('aria-label', '그리기 도구 접기/펴기');
  collapseButton.setAttribute?.('title', '그리기 도구 접기/펴기');

  header.appendChild(handle);
  header.appendChild(title);
  header.appendChild(collapseButton);

  const content = documentRef.createElement('div');
  content.className = 'mpv-fabric-pilot-toolbar-content';

  // 라벨이 있는 섹션의 래퍼. 도구에 따라 관련 섹션만 남기기 위해 id 로 찾는다.
  const sectionElements = new Map();

  for (const section of sections) {
    const items = Array.isArray(section?.items) ? section.items : [];
    const appended = Array.isArray(section?.appended) ? section.appended : [];
    if (!section?.label) {
      // 라벨이 없는 묶음(선택 설정 그룹·상태 배지)은 표시 여부를 스스로 관리하므로
      // 래퍼 없이 바로 붙여 접힘/펼침 시 빈 줄이 남지 않게 한다
      for (const item of items) content.appendChild(item);
      for (const item of appended) content.appendChild(item);
      continue;
    }
    const sectionElement = documentRef.createElement('div');
    sectionElement.className = 'mpv-fabric-pilot-section';
    sectionElement.dataset.fabricPilotSection = String(section.id || section.label);
    const label = documentRef.createElement('div');
    label.className = 'mpv-fabric-pilot-section-label';
    label.textContent = section.label;
    const row = documentRef.createElement('div');
    row.className = 'mpv-fabric-pilot-section-row';
    // 항목이 많은 섹션(도구 줄)은 한 줄로 늘어놓으면 팔레트를 넘친다.
    // 렌더러 구조는 그대로 두고 표시만 그리드로 바꾼다.
    // minmax(0, 1fr) 이어야 트랙이 버튼의 min-width 보다 작아질 수 있다 —
    // 1fr 만 쓰면 min-content(= min-width 40px)가 하한이 되어 팔레트를 넘친다.
    if (section.layout === 'grid') {
      const columns = Math.max(1, Number(section.columns) || 4);
      const gap = typeof section.gap === 'string' ? section.gap : '4px';
      row.dataset.layout = 'grid';
      applyStyles(row, {
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap
      });
      for (const item of items) {
        applyStyles(item, { minWidth: '0', padding: '0' });
      }
    }
    for (const item of items) row.appendChild(item);
    // 섹션 라벨을 눌러 그 섹션만 접는다. 팔레트 전체 접기와는 별개다.
    label.setAttribute?.('role', 'button');
    label.setAttribute?.('tabindex', '0');
    label.dataset.collapsed = 'false';
    // 접기 직전의 붙임 패널 표시 상태. 다시 펼칠 때 '' 로 비우면 도형 플라이아웃과
    // 브러시 설정 패널이 닫혀 있었는데도 함께 열려 버린다.
    const appendedDisplay = new WeakMap();
    const toggleSection = () => {
      const collapsed = label.dataset.collapsed !== 'true';
      label.dataset.collapsed = String(collapsed);
      // grid 로 만든 섹션을 flex 로 되돌리면 도구 줄이 한 줄로 무너진다.
      applyStyles(row, {
        display: collapsed ? 'none' : (row.dataset.layout === 'grid' ? 'grid' : 'flex')
      });
      for (const item of appended) {
        if (collapsed) {
          appendedDisplay.set(item, item?.style?.display ?? '');
          applyStyles(item, { display: 'none' });
          continue;
        }
        applyStyles(item, { display: appendedDisplay.get(item) ?? '' });
      }
    };
    listen(label, 'click', toggleSection);
    listen(label, 'keydown', event => {
      if (event?.key !== 'Enter' && event?.key !== ' ') return;
      event.preventDefault?.();
      toggleSection();
    });
    sectionElement.appendChild(label);
    sectionElement.appendChild(row);
    for (const item of appended) sectionElement.appendChild(item);
    sectionElements.set(String(section.id || section.label), sectionElement);
    content.appendChild(sectionElement);
  }

  element.appendChild(header);
  element.appendChild(content);

  function applyCollapsedState() {
    element.dataset.collapsed = String(state.collapsed);
    collapseButton.setAttribute?.('aria-expanded', String(!state.collapsed));
    applyStyles(content, { display: state.collapsed ? 'none' : 'flex' });
  }

  function applyPosition(position) {
    const size = {
      width: finitePaletteNumber(element.offsetWidth, 0) || PALETTE_FALLBACK_WIDTH,
      height: finitePaletteNumber(element.offsetHeight, 0) || PALETTE_FALLBACK_HEIGHT
    };
    const clamped = clampPalettePosition(position, readPaletteViewport(windowRef), size);
    state = { ...state, ...clamped };
    applyStyles(element, { left: `${clamped.left}px`, top: `${clamped.top}px` });
    return clamped;
  }

  function persist() {
    writeStoredPaletteState(windowRef, state);
  }

  function setCollapsed(collapsed) {
    state = { ...state, collapsed: collapsed === true };
    applyCollapsedState();
    applyPosition(state);
    persist();
    return state.collapsed;
  }

  function isCollapseTarget(target) {
    if (!target) return false;
    if (target === collapseButton) return true;
    if (typeof target.closest === 'function') {
      return target.closest('.mpv-fabric-pilot-collapse-button') !== null;
    }
    return target.parentNode === collapseButton;
  }

  function endDrag(event) {
    if (!dragOrigin) return;
    if (dragPointerId !== null && event?.pointerId !== undefined &&
        event.pointerId !== dragPointerId) return;
    try {
      header.releasePointerCapture?.(dragPointerId);
    } catch (_error) {
      // 캡처가 없으면 해제도 필요 없다
    }
    dragOrigin = null;
    dragPointerId = null;
    persist();
  }

  listen(collapseButton, 'click', () => setCollapsed(!state.collapsed));

  listen(header, 'pointerdown', event => {
    if (event?.button !== undefined && event.button !== 0) return;
    if (isCollapseTarget(event?.target)) return;
    dragPointerId = event?.pointerId === undefined ? null : event.pointerId;
    dragOrigin = {
      pointerX: finitePaletteNumber(event?.clientX, 0),
      pointerY: finitePaletteNumber(event?.clientY, 0),
      left: state.left,
      top: state.top
    };
    try {
      header.setPointerCapture?.(event.pointerId);
    } catch (_error) {
      // 합성 포인터에서는 캡처가 실패할 수 있다
    }
    event?.preventDefault?.();
  });

  listen(documentRef, 'pointermove', event => {
    if (!dragOrigin) return;
    if (dragPointerId !== null && event?.pointerId !== undefined &&
        event.pointerId !== dragPointerId) return;
    applyPosition({
      left: dragOrigin.left + (finitePaletteNumber(event?.clientX, 0) - dragOrigin.pointerX),
      top: dragOrigin.top + (finitePaletteNumber(event?.clientY, 0) - dragOrigin.pointerY)
    });
  });

  listen(documentRef, 'pointerup', endDrag);
  listen(documentRef, 'pointercancel', endDrag);
  listen(windowRef, 'resize', () => applyPosition(state));

  applyCollapsedState();

  // 도구에 따라 라벨이 있는 섹션을 통째로 숨긴다. 라벨 없는 묶음(선택 설정·상태)은
  // 래퍼가 없어 여기에 등록되지 않으며, 자체적으로 표시를 관리한다.
  function setSectionVisible(id, visible) {
    const sectionElement = sectionElements.get(String(id));
    if (!sectionElement) return false;
    // 보일 때는 인라인 값을 비워 CSS 가 정한 세로 배치를 그대로 쓴다.
    // 'flex' 를 강제하면 flex-direction 이 없어 라벨·버튼 줄·설정 패널이
    // 가로로 늘어서서 좁은 팔레트를 넘친다.
    applyStyles(sectionElement, { display: visible ? '' : 'none' });
    return true;
  }

  return {
    element,
    header,
    content,
    collapseButton,
    restore() {
      applyCollapsedState();
      return applyPosition(state);
    },
    setSectionVisible,
    setCollapsed,
    isCollapsed: () => state.collapsed,
    getState: () => ({ ...state })
  };
}

module.exports = {
  createFabricDrawingPalette,
  clampPalettePosition,
  normalizePaletteState,
  PALETTE_STORAGE_KEY,
  PALETTE_MARGIN
};
