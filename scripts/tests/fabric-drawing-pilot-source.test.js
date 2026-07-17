const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));

test('Fabric pilot controller is initialized with live mpv video and canvas context', () => {
  assert.match(appSource, /import \{ createFabricDrawingPilotController \} from '\.\/modules\/fabric-drawing-pilot-controller\.js';/);
  assert.match(appSource, /const mpvOverlayLifecycle = createMpvOverlayLifecycle\([\s\S]+const fabricDrawingPilotController = createFabricDrawingPilotController\(\{/);
  assert.match(appSource, /getContext: getFabricDrawingPilotContext/);
  assert.match(appSource, /function getFabricDrawingPilotContext\(\) \{[\s\S]+const renderArea = getVideoRenderArea\(\);[\s\S]+isMpvActive: isMpvPilotPlaybackActive\(\),[\s\S]+isAudio: state\.isAudioMode,[\s\S]+stableVideoIdentity: videoPlayer\.filePath \|\| state\.currentFile \|\| '',[\s\S]+targetFrame: videoPlayer\.currentFrame,[\s\S]+sourceWidth: videoPlayer\.videoWidth,[\s\S]+sourceHeight: videoPlayer\.videoHeight,[\s\S]+canvasRect:/);
  assert.match(appSource, /const fabricDrawingPilotInitialization = fabricDrawingPilotController\.initialize\(\);/);
  assert.ok(
    appSource.indexOf('let fabricDrawingPilotUiEngaged = false;') <
      appSource.indexOf('const fabricDrawingPilotInitialization = fabricDrawingPilotController.initialize();'),
    'pilot UI state must exist before asynchronous initialization can deliver state'
  );
});

test('overlay capability and real load tokens reconcile only confirmed normal video loads', () => {
  assert.match(appSource, /async function prepareMpvOverlayHost\(\) \{[\s\S]+await fabricDrawingPilotInitialization;[\s\S]+await fabricDrawingPilotController\.adoptOverlayCapability\(result\.drawingCapability\);/);
  assert.match(appSource, /activeVideoLoadToken = loadToken;\n\s+activeVideoLoadPath = filePath;\n\s+if \(!engineSwap\) \{\n\s+await fabricDrawingPilotController\.beforeVideoChange\(loadToken\);/);
  assert.match(appSource, /await fabricDrawingPilotController\.beforeVideoChange\(loadToken\);\n\s+if \(!canContinueVideoLoad\(\)\) \{\n\s+await fabricDrawingPilotController\.cancelVideoChange\(loadToken\);[\s\S]+activeVideoLoadToken = null;[\s\S]+activeVideoLoadPath = null;[\s\S]+return false;\n\s+\}/);
  assert.match(appSource, /if \(!engineSwap && canContinueVideoLoad\(\)\) \{[\s\S]+await fabricDrawingPilotController\.afterVideoReady\(\{[\s\S]+\.\.\.getFabricDrawingPilotContext\(\),[\s\S]+loadToken[\s\S]+\}\);/);
  assert.match(appSource, /if \(!engineSwap && !videoLoadCompleted\) \{\n\s+await fabricDrawingPilotController\.cancelVideoChange\(loadToken\);\n\s+\}/);
});

test('pilot state and B routing avoid every legacy playback and persistence mutation', () => {
  assert.match(appSource, /onStateChange: handleFabricDrawingPilotStateChange/);
  assert.match(appSource, /let fabricDrawingPilotUiEngaged = false;/);
  assert.match(appSource, /function handleFabricDrawingPilotStateChange\(nextState, snapshot\) \{[\s\S]+const wasEngaged = fabricDrawingPilotUiEngaged;[\s\S]+if \(!engaged && !wasEngaged\) return;[\s\S]+fabricDrawingPilotUiEngaged = engaged;[\s\S]+state\.isDrawMode = nextState === 'active' \|\| nextState === 'preparing';[\s\S]+setDrawModePreparingState\([\s\S]+setDrawModeReadyState\(false\);/);
  const toggle = appSource.match(/function toggleDrawMode\(\) \{([\s\S]*?)\n  \}\n\n  \/\*\*/)?.[1] || '';
  assert.match(toggle, /fabricDrawingPilotController\.isEnabled\(\) && isMpvPilotPlaybackActive\(\)/);
  assert.match(toggle, /void fabricDrawingPilotController\.toggle\(\);\n\s+return;/);
  const pilotBranch = toggle.match(/if \(fabricDrawingPilotController\.isEnabled\(\) && isMpvPilotPlaybackActive\(\)\) \{([\s\S]*?)\n\s+\}/)?.[1] || '';
  assert.doesNotMatch(pilotBranch, /videoPlayer\.pause|loadVideo|enterHybridReviewEngineIfPossible|showMpvReviewFreezeFrame|drawingManager|reviewDataManager/);
  const stateHandler = appSource.match(/function handleFabricDrawingPilotStateChange\(nextState, snapshot\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.doesNotMatch(stateHandler, /videoPlayer\.(?:play|pause|load)|loadVideo|enterHybridReviewEngineIfPossible|showMpvReviewFreezeFrame|drawingManager|reviewDataManager|\.save\(/);
});

test('capture keyboard and click firewalls stop legacy drawing mutations while keeping navigation separate', () => {
  assert.match(appSource, /if \(e\.code === 'Space' && state\.isDrawMode && !isFabricDrawingPilotEngaged\(\)\) \{/);
  assert.match(appSource, /if \(shouldIgnoreGlobalShortcutTarget\(shortcutTarget\)\) return;\n\n\s+if \(fabricDrawingPilotController\.routeKeydown\(e\)\) return;\n\s+if \(shouldBlockFabricDrawingLegacyShortcut\(e\)\) \{/);
  assert.match(appSource, /const FABRIC_DRAWING_LEGACY_SHORTCUTS = new Set\(\[[\s\S]+drawingLayerAdd[\s\S]+keyframeAddWithCopy[\s\S]+frameCopy[\s\S]+onionSkinToggle[\s\S]+drawingToolSelect[\s\S]+\]\);/);
  assert.match(appSource, /document\.addEventListener\('click', handleFabricDrawingPilotLegacyClick, true\);/);
  assert.match(appSource, /function handleFabricDrawingPilotLegacyClick\(event\) \{[\s\S]+event\.preventDefault\(\);[\s\S]+event\.stopImmediatePropagation\(\);[\s\S]+\}/);
  assert.match(appSource, /if \(shouldBlockFabricDrawingLegacyShortcut\(e\)\) \{\n\s+e\.preventDefault\(\);\n\s+e\.stopImmediatePropagation\(\);\n\s+return;\n\s+\}/);
  assert.match(appSource, /#drawingTools[\s\S]+#btnUndo[\s\S]+#btnClearDrawing[\s\S]+#btnAddLayer[\s\S]+#btnDeleteLayer[\s\S]+\.layer-settings-popup[\s\S]+\.drawing-layer-header[\s\S]+\.drawing-track-row/);
  assert.match(mainCss, /body\.fabric-drawing-pilot-engaged #drawingTools[\s\S]+visibility:\s*hidden;[\s\S]+pointer-events:\s*none;/);
  assert.match(mainCss, /body\.fabric-drawing-pilot-engaged \.drawing-overlay[\s\S]+visibility:\s*hidden;[\s\S]+pointer-events:\s*none(?:\s*!important)?;/);
  assert.match(appSource, /drawingDataUrl: isFabricDrawingPilotEngaged\(\) \? '' : getCompositedDrawingOverlayDataUrl\(\)/);
});

test('freeze and system shutdown paths are conditional on pilot ownership', () => {
  assert.match(appSource, /function requiresMpvReviewFreeze\(\) \{\n\s+return state\.isCommentMode \|\|\n\s+\(state\.isDrawMode && !fabricDrawingPilotController\.isActiveOrPreparing\(\)\);\n\s+\}/);
  assert.match(appSource, /function exitDrawModeForSystemPath\(\) \{[\s\S]+isFabricDrawingPilotControllerEngaged\(\)[\s\S]+fabricDrawingPilotController\.disable\(\)[\s\S]+applyDrawModeState\(false\);/);
  for (const eventName of ['play', 'pause', 'ended']) {
    const handler = appSource.match(new RegExp(`videoPlayer\\.addEventListener\\('${eventName}', \\(\\) => \\{([\\s\\S]*?)\\n  \\}\\);`))?.[1] || '';
    assert.match(handler, /!fabricDrawingPilotController\.isActiveOrPreparing\(\)/, `${eventName} must not enter the legacy MPV freeze path while Fabric owns drawing`);
  }
  assert.doesNotMatch(appSource, /mpv 엔진을 BAEFRAME 영상 영역에 연결했습니다|mpv 파일럿으로 원본 영상을 직접 열었습니다/);
  assert.doesNotMatch(appSource, /showToast\([^;]*(?:mpv|원본 영상)[^;]*['"]success['"]/i);
});
