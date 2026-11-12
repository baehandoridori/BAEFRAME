const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

// 하이브리드 리뷰 엔진은 댓글·그리기 모드에 들어갈 때 같은 파일을 HTML5 로 다시 열던 전환이다.
// v2.12.7-beta(2026-09-22)에서 제거했다 — DEVLOG/2026-09-22-current-drawing-only.md.
// 이 파일은 (1) 그 전환이 되살아나지 않는지, (2) 전환이 함께 맡던 일(진입하자마자 켜지는
// 준비중 표시, 모드를 나올 때의 정리)을 지금의 경로가 하는지 확인한다.

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));

const appNodes = [];
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type) appNodes.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk(value);
  }
})(acorn.parse(appSource, { ecmaVersion: 'latest', sourceType: 'module' }));

function appFunction(name) {
  const node = appNodes.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  assert.ok(node, `${name} 을(를) 찾지 못했다`);
  return appSource.slice(node.start, node.end);
}

function appListener(target, event) {
  const node = appNodes.find(n => n.type === 'CallExpression' &&
    appSource.slice(n.callee.start, n.callee.end) === `${target}.addEventListener` &&
    n.arguments[0]?.value === event);
  assert.ok(node, `${target} 의 ${event} 처리기를 찾지 못했다`);
  return `(${appSource.slice(node.arguments[1].start, node.arguments[1].end)})`;
}

function settingsMethod(name) {
  const match = userSettingsSource.match(new RegExp(`  ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} 을(를) 찾지 못했다`);
  return match[0];
}

const noop = () => {};

test('하이브리드 엔진 전환은 제거됐고, 같은 파일을 다른 엔진으로 다시 여는 요청이 없다', () => {
  const identifiers = new Set(appNodes.filter(node => node.type === 'Identifier').map(node => node.name));
  for (const removed of [
    'enterHybridReviewEngineIfPossible', 'exitHybridReviewEngineIfNeeded',
    'isHtml5DirectPlayableForReview', 'hybridReviewResumeMpvFile', 'prepareMpvDrawMode'
  ]) {
    assert.equal(identifiers.has(removed), false, `${removed} 이(가) 되살아났다`);
  }

  // loadVideo 의 engineSwap 과 loadVideoWithHtml5Fallback 의 skipReviewTransition 은 그 전환만 쓰던
  // 선택 사항이다. 선언이 남아 있더라도 기본값은 꺼짐이고, 값을 넘기는 호출이 없어야 한다.
  for (const option of ['engineSwap', 'skipReviewTransition']) {
    const passed = appNodes.filter(node => node.type === 'ObjectExpression')
      .flatMap(node => node.properties)
      .filter(property => property.type === 'Property' &&
        (property.key.name ?? property.key.value) === option);
    assert.equal(passed.length, 0, `${option} 을(를) 넘기는 호출이 있다`);

    const declared = appNodes.filter(node => node.type === 'ObjectPattern')
      .flatMap(node => node.properties)
      .filter(property => property.type === 'Property' && property.key.name === option);
    for (const declaration of declared) {
      assert.equal(declaration.value.type, 'AssignmentPattern', `${option} 에 기본값이 없다`);
      assert.equal(declaration.value.right.value, false, `${option} 의 기본값이 꺼짐이 아니다`);
    }
  }
});

test('폐기된 하이브리드 설정은 저장된 값과 상관없이 꺼져 있고, 켜는 화면도 읽는 코드도 없다', () => {
  assert.match(userSettingsSource, /hybridReviewEngine: false,/);

  const userSettings = vm.runInNewContext(
    `({${settingsMethod('getHybridReviewEngine')},\n${settingsMethod('setHybridReviewEngine')}})`,
    { log: { info: noop } }
  );
  // 옛 버전이 켜 둔 값이 그대로 남아 있는 PC.
  Object.assign(userSettings, { settings: { hybridReviewEngine: true }, _save: noop, _emit: noop });
  assert.equal(userSettings.getHybridReviewEngine(), false);
  userSettings.setHybridReviewEngine(true);
  assert.equal(userSettings.settings.hybridReviewEngine, false);
  assert.equal(userSettings.getHybridReviewEngine(), false);

  // 앱은 이 설정을 읽지도 바꾸지도 않고, 설정 화면에 켜는 스위치도 없다.
  assert.equal(appSource.includes('HybridReviewEngine'), false);
  assert.doesNotMatch(indexSource, /id="appSettingsHybridReviewEngine"/);
});

test('코멘트 진입은 준비중 표시를 먼저 켜고 지금 재생 화면에서 준비한다. 나올 때는 정지 화면만 푼다', () => {
  const calls = [];
  const reload = name => () => { calls.push(`reload:${name}`); return Promise.resolve(false); };
  const context = vm.createContext({
    state: { isCommentMode: false, commentModePauseOwner: null },
    commentModePreparationToken: 0,
    suppressReviewFreezeReleaseForMediaChange: false,
    mpvPlayback: true,
    endVideoPan: noop, cancelSidebarCommentDraft: noop, removePendingMarkerUI: noop,
    exitDrawModeForSystemPath: () => calls.push('exit-draw'),
    isMpvPilotPlaybackActive: () => context.mpvPlayback,
    isMpvReviewInteractionActive: () => false,
    setCommentModeReadyState: ready => calls.push(`ready:${ready}`),
    setCommentModePreparingState: preparing => calls.push(`preparing:${preparing}`),
    // 준비는 끝나지 않은 채로 둔다. 표시는 그 전에 켜져 있어야 한다.
    prepareMpvCommentMode: token => { calls.push(`prepare:${token}`); return new Promise(noop); },
    showCommentModeGuidance: () => calls.push('guidance'),
    releaseMpvReviewFreezeFrame: () => { calls.push('release-freeze'); return Promise.resolve(); },
    // 파일을 다시 여는 길. 모드를 드나드는 것만으로는 불리면 안 된다.
    loadVideo: reload('loadVideo'),
    loadVideoWithHtml5Fallback: reload('loadVideoWithHtml5Fallback'),
    loadVideoWithMpvPilot: reload('loadVideoWithMpvPilot')
  });
  const onCommentModeChanged = vm.runInContext(appListener('commentManager', 'commentModeChanged'), context);
  const run = (isCommentMode) => {
    calls.length = 0;
    onCommentModeChanged({ detail: { isCommentMode } });
    return [...calls];
  };

  assert.deepEqual(run(true), ['exit-draw', 'ready:false', 'preparing:true', 'prepare:1']);
  assert.deepEqual(run(false), ['preparing:false', 'ready:false', 'release-freeze']);

  // 영상을 바꾸는 중에는 정지 화면을 그 전환이 쥐고 있으므로 여기서 풀지 않는다.
  context.suppressReviewFreezeReleaseForMediaChange = true;
  assert.deepEqual(run(false), ['preparing:false', 'ready:false']);
  context.suppressReviewFreezeReleaseForMediaChange = false;

  // HTML5 재생에서는 준비할 것이 없으므로 바로 입력을 받는다.
  context.mpvPlayback = false;
  assert.deepEqual(run(true), ['exit-draw', 'preparing:false', 'ready:true', 'guidance']);
});

test('B 토글은 복구·소스 갱신 중에 침묵 폐기되지 않고 예약된다', () => {
  const controllerSource = fs.readFileSync(
    path.join(rootDir, 'renderer/scripts/modules/fabric-drawing-pilot-controller.js'), 'utf8'
  );
  assert.match(controllerSource, /if \(state === 'recovering'\) \{\s*\n\s*\/\/ 복구가 끝나면 자동으로/);
  assert.match(controllerSource, /resumeRequested = !resumeRequested;/);
});

test('드로잉 진입은 준비가 끝나기 전에 준비중 표시를 켜고, 준비가 끝나면 끈다', () => {
  const element = () => {
    const classes = new Set();
    const attributes = new Map();
    return {
      classList: {
        toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
        contains: name => classes.has(name)
      },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: name => attributes.get(name)
    };
  };
  const elements = { btnDrawMode: element(), drawingCanvas: element(), videoWrapper: element() };
  const context = vm.createContext({
    elements,
    state: { isDrawMode: false },
    document: { body: { dataset: {}, classList: element().classList } },
    log: { warn: noop },
    fabricDrawingPilotStatusSnapshot: null, lastLoggedFabricPersistenceReason: null,
    fabricDrawingPilotFailureToastShown: false, fabricDrawingPilotUiEngaged: false,
    fabricDrawingPilotController: { shouldOwnDrawingShortcut: () => true },
    isCurrentDrawingSurfaceReady: () => true,
    seedFabricDrawingLayerAssignmentTracking: noop, pushFabricPilotLayerView: noop,
    pushFabricPilotPalettePrefs: noop, pushFabricPilotLayerViewAfterDisplay: noop,
    pushFabricPilotOnionSkinPrefs: noop, syncFabricOnionSkinPlayback: noop,
    resetMpvOverlayCollaborationDrag: noop, scheduleMpvOverlayStateSync: noop,
    renderActiveDrawingLayers: noop, syncCommentInteractionPolicy: noop,
    notifyFabricDrawingPilotFailure: noop
  });
  vm.runInContext(
    ['setDrawModePreparingState', 'setDrawModeReadyState', 'handleFabricDrawingPilotStateChange']
      .map(appFunction).join('\n'),
    context
  );
  const indicator = () => ({
    wrapper: elements.videoWrapper.classList.contains('drawing-mode-preparing'),
    button: elements.btnDrawMode.classList.contains('preparing'),
    busy: elements.btnDrawMode.getAttribute('aria-busy'),
    active: elements.btnDrawMode.classList.contains('active'),
    drawMode: context.state.isDrawMode
  });

  // 컨트롤러는 B 를 받자마자 'preparing' 을 알린다. 그때부터 표시가 켜져 있어야 한다.
  context.handleFabricDrawingPilotStateChange('preparing', {});
  assert.deepEqual(indicator(), { wrapper: true, button: true, busy: 'true', active: false, drawMode: true });
  context.handleFabricDrawingPilotStateChange('active', {});
  assert.deepEqual(indicator(), { wrapper: false, button: false, busy: 'false', active: true, drawMode: true });

  // 복구가 끝나면 다시 켜기로 예약돼 있을 때(복구 중에 B 를 누른 경우)에도 준비중으로 보인다.
  context.handleFabricDrawingPilotStateChange('recovering', { resumeRequested: true });
  assert.deepEqual(indicator(), { wrapper: true, button: true, busy: 'true', active: false, drawMode: false });
  context.handleFabricDrawingPilotStateChange('recovering', { resumeRequested: false });
  assert.deepEqual(indicator(), { wrapper: false, button: false, busy: 'false', active: false, drawMode: false });
  context.handleFabricDrawingPilotStateChange('passive', {});
  assert.deepEqual(indicator(), { wrapper: false, button: false, busy: 'false', active: false, drawMode: false });

  // 구형 캔버스는 어느 단계에서도 입력을 받는 상태가 되지 않는다.
  assert.equal(elements.drawingCanvas.classList.contains('active'), false);
  assert.equal(elements.videoWrapper.classList.contains('drawing-mode'), false);
});
