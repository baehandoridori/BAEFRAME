const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = path.resolve(__dirname, '../..');
const read = relativePath =>
  fs.readFileSync(path.join(rootDir, relativePath), 'utf8').replace(/\r\n/g, '\n');
const {
  FABRIC_PALETTE_SAVED_COLOR_LIMIT,
  FABRIC_PALETTE_MIN_BRUSH_SIZE,
  FABRIC_PALETTE_MAX_BRUSH_SIZE,
  FABRIC_PALETTE_MIN_OPACITY_PERCENT,
  FABRIC_PALETTE_MAX_OPACITY_PERCENT,
  normalizeFabricPalettePrefs
} = require(path.join(rootDir, 'shared/fabric-palette-prefs.js'));
const {
  createFabricOverlayRuntime
} = require(path.join(rootDir, 'renderer/scripts/modules/mpv-fabric-overlay-runtime.js'));

const userSettingsSource = read('renderer/scripts/modules/user-settings.js');
const appSource = read('renderer/scripts/app.js');
const ipcHandlersSource = read('main/ipc-handlers.js');
const packageJson = JSON.parse(read('package.json'));

const validPrefs = () => ({
  color: '#a55eea',
  size: 12,
  opacity: 60,
  savedColors: ['#123456', '#abcdef']
});

// 팔레트 값을 다루는 부분만 본다. DOM 을 만들지 않아도 값 적용과 조회는 동작한다.
function createPaletteRuntime() {
  return createFabricOverlayRuntime({
    fabric: { Canvas: class {}, Path: class {} },
    document: { createElement: () => ({}) }
  });
}

// user-settings.js 는 브라우저 ES 모듈이다. import 를 걷어 내고 같은 소스를 그대로 돌린다.
function loadUserSettings({ stored = null } = {}) {
  const saved = [];
  const storage = new Map(stored ? [['baeframe_user_settings', JSON.stringify(stored)]] : []);
  const source = userSettingsSource
    .replace(/^import [^\n]+\n/gm, '')
    .replace(/^export default [^\n]+\n/m, '')
    .replace(/^export /gm, '');
  const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
  const { UserSettings } = new Function(
    'createLogger',
    'getAuthManager',
    'normalizeEraserMode',
    'localStorage',
    'window',
    'document',
    `${source}\nreturn { UserSettings };`
  )(
    () => noopLogger,
    () => ({}),
    mode => (mode === 'stroke' ? 'stroke' : 'pixel'),
    {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => {
        storage.set(key, value);
        saved.push(JSON.parse(value));
      }
    },
    {},
    { readyState: 'complete', addEventListener() {} }
  );
  return { settings: new UserSettings(), saved };
}

test('palette values cross process boundaries only in one exact normalized form', () => {
  const prefs = validPrefs();
  const normalized = normalizeFabricPalettePrefs(prefs);
  assert.deepEqual(normalized, prefs);
  // 검증을 통과한 값은 새 객체다. 호출자가 나중에 고쳐도 건너간 값은 바뀌지 않는다.
  assert.notEqual(normalized, prefs);
  assert.notEqual(normalized.savedColors, prefs.savedColors);
  assert.deepEqual(normalizeFabricPalettePrefs({ ...prefs, savedColors: [] }).savedColors, []);

  const throwing = {};
  Object.defineProperty(throwing, 'color', {
    enumerable: true,
    get() {
      throw new Error('accessor');
    }
  });
  for (const [label, malformed] of [
    ['null', null],
    ['배열', []],
    ['문자열', '#a55eea'],
    ['빠진 키', { color: prefs.color, size: prefs.size, opacity: prefs.opacity }],
    ['남는 키', { ...prefs, tool: 'brush' }],
    ['클래스 인스턴스', Object.assign(new (class Prefs {})(), prefs)],
    ['프로토타입 없는 객체', Object.assign(Object.create(null), prefs)],
    ['던지는 접근자', Object.assign(throwing, { size: 12, opacity: 60, savedColors: [] })],
    // 느슨한 색 표기는 사용자가 글자를 치는 런타임 안에서만 받는다.
    ['대문자 색', { ...prefs, color: '#A55EEA' }],
    ['# 없는 색', { ...prefs, color: 'a55eea' }],
    ['세 자리 색', { ...prefs, color: '#a5e' }],
    ['알파가 붙은 색', { ...prefs, color: '#a55eeaff' }],
    ['숫자 색', { ...prefs, color: 0xa55eea }],
    ['작은 굵기', { ...prefs, size: FABRIC_PALETTE_MIN_BRUSH_SIZE - 1 }],
    ['큰 굵기', { ...prefs, size: FABRIC_PALETTE_MAX_BRUSH_SIZE + 1 }],
    ['소수 굵기', { ...prefs, size: 12.5 }],
    ['문자열 굵기', { ...prefs, size: '12' }],
    ['낮은 불투명도', { ...prefs, opacity: FABRIC_PALETTE_MIN_OPACITY_PERCENT - 1 }],
    ['높은 불투명도', { ...prefs, opacity: FABRIC_PALETTE_MAX_OPACITY_PERCENT + 1 }],
    ['0~1 불투명도', { ...prefs, opacity: 0.6 }],
    ['배열이 아닌 내 색', { ...prefs, savedColors: '#123456' }],
    ['중복된 내 색', { ...prefs, savedColors: ['#123456', '#123456'] }],
    ['잘못된 내 색', { ...prefs, savedColors: ['#123456', 'red'] }],
    ['너무 많은 내 색', {
      ...prefs,
      savedColors: Array.from(
        { length: FABRIC_PALETTE_SAVED_COLOR_LIMIT + 1 },
        (_value, index) => `#00000${index}`
      )
    }]
  ]) {
    assert.equal(normalizeFabricPalettePrefs(malformed), null, label);
  }
});

test('whatever the palette runtime reports is accepted by the boundary validator', () => {
  const runtime = createPaletteRuntime();
  // 기본값부터 통과해야 한다. 그리기를 처음 켠 직후에도 알림이 나갈 수 있다.
  assert.deepEqual(
    normalizeFabricPalettePrefs(runtime.getDiagnostics().palette),
    { color: '#ff4757', size: 3, opacity: 100, savedColors: [] }
  );

  // 런타임은 범위를 벗어난 저장값을 경계로 잘라 받는다. 잘린 결과가 검증기의 한도와
  // 같지 않으면, 이쪽이 만든 값을 경계가 거부해 보존이 조용히 멈춘다.
  const applied = runtime.applyPalettePrefs({
    color: '#ABCDEF',
    size: 9999,
    opacity: -5,
    savedColors: Array.from({ length: 12 }, (_value, index) => `#1000${String(index).padStart(2, '0')}`)
  });
  assert.equal(applied.accepted, true);
  assert.equal(applied.color, '#abcdef');
  assert.equal(applied.size, FABRIC_PALETTE_MAX_BRUSH_SIZE);
  assert.equal(applied.opacity, FABRIC_PALETTE_MIN_OPACITY_PERCENT);
  assert.equal(applied.savedColors.length, FABRIC_PALETTE_SAVED_COLOR_LIMIT);
  assert.deepEqual(
    normalizeFabricPalettePrefs(runtime.getDiagnostics().palette),
    runtime.getDiagnostics().palette
  );

  const lower = createPaletteRuntime().applyPalettePrefs({ color: '#000000', size: -3, opacity: 999 });
  assert.equal(lower.size, FABRIC_PALETTE_MIN_BRUSH_SIZE);
  assert.equal(lower.opacity, FABRIC_PALETTE_MAX_OPACITY_PERCENT);
});

test('user settings keep the palette values in the form the overlay accepts', () => {
  // 이 파일은 ES 모듈이라 공유 모듈을 import 할 수 없어 한도를 따로 적는다. 값이 갈리면
  // 설정에는 저장되는데 오버레이에는 심기지 않는다.
  const limit = userSettingsSource.match(/const PALETTE_SAVED_COLOR_LIMIT = (\d+);/);
  assert.ok(limit, '내 색 칸 수 상수가 있어야 한다');
  assert.equal(Number(limit[1]), FABRIC_PALETTE_SAVED_COLOR_LIMIT);

  const { settings, saved } = loadUserSettings();
  assert.deepEqual(settings.getFabricPalettePrefs(), {
    color: '#ff4757',
    size: 3,
    opacity: 100,
    savedColors: []
  });
  assert.deepEqual(
    normalizeFabricPalettePrefs(settings.getFabricPalettePrefs()),
    settings.getFabricPalettePrefs()
  );

  const prefs = validPrefs();
  const before = settings.getBrushSettings();
  settings.setFabricPalettePrefs(prefs);
  assert.deepEqual(settings.getFabricPalettePrefs(), prefs);
  // 저장소에 실제로 적힌다. 적히지 않으면 앱을 껐다 켰을 때 기본값으로 돌아간다.
  assert.deepEqual(saved.at(-1).drawingPalette, prefs);
  // 넘겨받은 배열을 그대로 쥐지 않는다. 호출자가 나중에 고쳐도 저장값은 그대로다.
  prefs.savedColors.push('#000001');
  assert.equal(settings.getFabricPalettePrefs().savedColors.length, 2);
  // 구형 도구의 값(brushSettings)은 건드리지 않는다.
  assert.deepEqual(settings.getBrushSettings(), before);
});

test('damaged or legacy stored values never block or leak into the palette', () => {
  // 손으로 고친 설정 파일이나 일부만 남은 값이 들어 있어도, 꺼내 줄 때는 오버레이가
  // 받는 형식이어야 한다. 하나라도 어긋나면 통째로 거절돼 아무것도 심기지 않는다.
  const { settings } = loadUserSettings({
    stored: {
      drawingPalette: {
        color: 'RED',
        size: '900',
        opacity: 3,
        savedColors: ['#ABCDEF', 'nope', '#abcdef', 42, '#111111', '#222222', '#333333',
          '#444444', '#555555', '#666666', '#777777']
      }
    }
  });
  const prefs = settings.getFabricPalettePrefs();
  assert.equal(prefs.color, '#ff4757');
  assert.equal(prefs.size, FABRIC_PALETTE_MAX_BRUSH_SIZE);
  assert.equal(prefs.opacity, FABRIC_PALETTE_MIN_OPACITY_PERCENT);
  assert.deepEqual(prefs.savedColors, [
    '#abcdef', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666'
  ]);
  assert.deepEqual(normalizeFabricPalettePrefs(prefs), prefs);

  for (const drawingPalette of [null, 'palette', [], { size: -4, opacity: 'x' }, { color: '#26DE81' }]) {
    const loaded = loadUserSettings({ stored: { drawingPalette } }).settings.getFabricPalettePrefs();
    assert.deepEqual(normalizeFabricPalettePrefs(loaded), loaded, JSON.stringify(drawingPalette));
  }
  assert.deepEqual(
    loadUserSettings({ stored: { drawingPalette: { color: '#26DE81' } } }).settings.getFabricPalettePrefs(),
    { color: '#26de81', size: 3, opacity: 100, savedColors: [] }
  );
  assert.equal(
    loadUserSettings({ stored: { drawingPalette: { size: -4 } } }).settings.getFabricPalettePrefs().size,
    FABRIC_PALETTE_MIN_BRUSH_SIZE
  );

  // 지금은 없는 구형 도구가 남긴 값은 새 팔레트로 넘어오지 않는다. 몇 달 전에 쓰던
  // 굵기와 색으로 첫 화면이 열리면 고장처럼 보인다.
  const legacy = loadUserSettings({
    stored: { brushSettings: { tool: 'pen', color: '#26DE81', brushSize: 40, opacity: 20 } }
  }).settings;
  assert.deepEqual(legacy.getFabricPalettePrefs(), {
    color: '#ff4757',
    size: 3,
    opacity: 100,
    savedColors: []
  });
  assert.equal(legacy.getBrushSettings().brushSize, 40, '구형 값 자체는 그대로 보존된다');
});

test('the main window gathers rapid palette changes into one save and never loses the last', async () => {
  // 오버레이는 값이 바뀔 때마다 알린다(1초에 수십 번일 수 있다). 그때마다 설정 파일을
  // 쓰면 안 되므로 메인 창이 마지막 값만 들고 있다가 조용해지면 한 번 저장한다.
  const { createFabricPalettePrefsSaver, FABRIC_PALETTE_PREFS_SAVE_DELAY_MS } = await import(
    pathToFileURL(path.join(rootDir, 'renderer/scripts/modules/fabric-palette-prefs-saver.js')).href
  );
  const saved = [];
  const timers = [];
  const saver = createFabricPalettePrefsSaver({
    save: prefs => saved.push(prefs),
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay, cleared: false });
      return timers.length;
    },
    clearTimeoutFn: handle => {
      timers[handle - 1].cleared = true;
    }
  });
  const prefs = color => ({ ...validPrefs(), color });

  assert.equal(saver.hasPending(), false);
  assert.equal(saver.flush(), false, '들고 있는 값이 없으면 저장하지 않는다');

  saver.push(prefs('#111111'));
  saver.push(prefs('#222222'));
  saver.push(prefs('#333333'));
  assert.deepEqual(saved, [], '조용해지기 전에는 저장하지 않는다');
  assert.equal(saver.hasPending(), true);
  assert.deepEqual(timers.map(timer => timer.cleared), [true, true, false]);
  assert.equal(timers.at(-1).delay, FABRIC_PALETTE_PREFS_SAVE_DELAY_MS);

  timers.at(-1).callback();
  assert.deepEqual(saved, [prefs('#333333')], '마지막 값 하나만 저장한다');
  assert.equal(saver.hasPending(), false);

  // 창이 닫히거나 오버레이에 값을 다시 심어야 할 때는 기다리지 않고 바로 적는다.
  saver.push(prefs('#444444'));
  assert.equal(saver.flush(), true);
  assert.deepEqual(saved.at(-1), prefs('#444444'));
  assert.equal(timers.at(-1).cleared, true);
  // 이미 적은 값을 늦게 발화한 타이머가 다시 적지 않는다.
  timers.at(-1).callback();
  assert.equal(saved.length, 2);

  assert.throws(() => createFabricPalettePrefsSaver({}), /save function/);
});

test('the main window stores overlay palette changes and replays them when drawing turns on', () => {
  // 오버레이에서 온 값은 모아서 사용자 설정에 적는다.
  assert.match(
    appSource,
    /const fabricPalettePrefsSaver = createFabricPalettePrefsSaver\(\{\n\s+save: prefs => userSettings\.setFabricPalettePrefs\(prefs\)\n\s+\}\);/
  );
  assert.match(
    appSource,
    /window\.electronAPI\?\.onFabricDrawingPalettePrefs\?\.\(prefs => \{\n\s+fabricPalettePrefsSaver\.push\(prefs\);\n\s+\}\);/
  );
  // 메인 창이 닫힐 때 아직 적지 못한 값을 적는다.
  assert.match(
    appSource,
    /window\.addEventListener\('beforeunload', \(\) => \{\n\s+fabricPalettePrefsSaver\.flush\(\);\n\s+\}\);/
  );
  // 그리기를 켤 때마다 보존해 둔 값을 심는다(오버레이 창이 새로 만들어졌을 수 있다).
  assert.match(
    appSource,
    /if \(nextState === 'active'\) \{[\s\S]{0,600}?pushFabricPilotPalettePrefs\(\);/
  );
  // 심기 전에 아직 적지 못한 변경을 먼저 적는다. 오버레이가 복구로 방금 새로 만들어졌다면
  // 그 변경이 새 팔레트가 받아야 할 최신 값이다.
  assert.match(
    appSource,
    /function pushFabricPilotPalettePrefs\(\) \{[\s\S]{0,420}?fabricPalettePrefsSaver\.flush\(\);\n\s+Promise\.resolve\(apply\(userSettings\.getFabricPalettePrefs\(\)\)\)/
  );
});

test('main process palette channels check the sender and validate before forwarding', () => {
  const prefsHandler = ipcHandlersSource.match(
    /ipcMain\.on\('mpv-overlay:palette-prefs', \(event, value\) => \{[\s\S]*?\n  \}\);/
  );
  assert.ok(prefsHandler, '팔레트 값 채널 처리기가 있어야 한다');
  // 오버레이 창이 보낸 것만, 검증을 거친 값만 메인 렌더러로 넘긴다.
  assert.match(prefsHandler[0], /!mpvOverlayHost\.isCurrentOverlaySender\(event\)/);
  assert.match(prefsHandler[0], /const normalized = normalizeFabricPalettePrefs\(value\);\n\s+if \(!normalized\) return;/);
  assert.match(prefsHandler[0], /mainWebContents\.send\('fabric-drawing:palette-prefs', normalized\);/);
  assert.doesNotMatch(prefsHandler[0], /send\('fabric-drawing:palette-prefs', value\)/);

  // 저장값을 오버레이에 심는 요청은 메인 렌더러만 할 수 있다(invokeFabricDrawingHost 가 확인한다).
  assert.match(
    ipcHandlersSource,
    /ipcMain\.handle\('mpv:apply-overlay-drawing-palette-prefs', \(event, prefs\) =>\n\s+invokeFabricDrawingHost\(event, \(\) => mpvOverlayHost\.applyDrawingPalettePrefs\(prefs\)\)\);/
  );
  // 글자 입력 알림은 발신자 확인을 호스트가 한다.
  assert.match(
    ipcHandlersSource,
    /ipcMain\.on\('mpv-overlay:text-entry', \(event, active\) => \{\n\s+if \(isFabricDrawingPilotEnabled\) mpvOverlayHost\.setTextEntryActive\(event, active\);\n\s+\}\);/
  );
});

test('drawing test script includes the palette value coverage', () => {
  assert.match(packageJson.scripts['test:drawing'], /fabric-palette-prefs\.test\.js/);
});
