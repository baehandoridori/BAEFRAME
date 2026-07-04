const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = mainCss.match(new RegExp(`(^|\\n)${escaped}\\s*\\{[\\s\\S]*?\\n\\}`));
  return match?.[0] || '';
}

test('drawing layer visibility and lock controls are real 24px buttons', () => {
  const visibilityBlock = cssBlock('.layer-visibility');
  const lockBlock = cssBlock('.layer-lock');

  assert.match(visibilityBlock, /width:\s*24px;/);
  assert.match(visibilityBlock, /height:\s*24px;/);
  assert.match(visibilityBlock, /min-width:\s*24px;/);
  assert.match(visibilityBlock, /display:\s*inline-flex;/);
  assert.match(visibilityBlock, /cursor:\s*pointer;/);

  assert.match(lockBlock, /width:\s*24px;/);
  assert.match(lockBlock, /height:\s*24px;/);
  assert.match(lockBlock, /font-size:\s*12px;/);
  assert.match(lockBlock, /cursor:\s*pointer;/);
  assert.match(mainCss, /button\.layer-lock:not\(\.locked\)\s*\{[\s\S]*?opacity:\s*0\.35;/);
  assert.doesNotMatch(mainCss, /(?<!button)\.layer-lock:not\(\.locked\)\s*\{/);
});

test('drawing layer header renders accessible SVG visibility and visible lock states', () => {
  assert.doesNotMatch(timelineSource, /👁/);
  assert.match(timelineSource, /header\.classList\.toggle\('layer-hidden', !layer\.visible\);/);
  assert.match(timelineSource, /<button class="layer-visibility" type="button" data-action="visibility"/);
  assert.match(timelineSource, /aria-pressed="\$\{layer\.visible\}"/);
  assert.match(timelineSource, /\$\{this\._getLayerVisibilityIcon\(layer\.visible\)\}/);
  assert.match(timelineSource, /<button class="layer-lock\$\{layer\.locked \? ' locked' : ''\}" type="button" data-action="lock"/);
  assert.match(timelineSource, /\$\{layer\.locked \? '🔒' : '🔓'\}/);
  assert.match(timelineSource, /title="\$\{this\._escapeHtml\(layer\.name\)\}"/);
  assert.match(timelineSource, />\$\{this\._escapeHtml\(layer\.name\)\}<\/span>/);
});

test('visibility icon helper is shared and renders a slash when disabled', () => {
  assert.match(timelineSource, /_getLayerVisibilityIcon\(enabled, size = 16\)/);
  assert.match(timelineSource, /width="\$\{size\}" height="\$\{size\}"/);
  assert.match(timelineSource, /<line x1="4" y1="20" x2="20" y2="4"><\/line>/);
  assert.match(timelineSource, /this\._getLayerVisibilityIcon\(layer\.enabled, 16\)/);
  assert.doesNotMatch(timelineSource, /_getCompositionLayerVisibilityIcon/);
});

test('hidden rows are visually subdued without shrinking hit areas', () => {
  assert.match(mainCss, /\.layer-header\.layer-hidden \.layer-visibility\s*\{[\s\S]*?opacity:\s*0\.45;/);
  assert.match(mainCss, /\.layer-header\.layer-hidden \.layer-name,[\s\S]*?\.layer-header\.layer-hidden \.layer-opacity-badge\s*\{[\s\S]*?opacity:\s*0\.5;/);
  assert.match(cssBlock('.composition-layer-header-visibility'), /width:\s*24px;[\s\S]*height:\s*24px;/);
  assert.doesNotMatch(mainCss, /\.drawing-layer-header \.layer-visibility\s*\{[\s\S]*?opacity:\s*0\.7;/);
});

test('video layer decorative controls keep matching icon size but do not look clickable', () => {
  assert.match(indexSource, /class="layer-header" data-layer="video"[\s\S]*<span class="layer-visibility">[\s\S]*width="16" height="16"/);
  assert.match(mainCss, /\.layer-header\[data-layer="video"\] \.layer-visibility\s*\{[\s\S]*?cursor:\s*default;/);
  assert.match(packageJson.scripts['test:frame-grid'], /layer-visibility-hit-area\.test\.js/);
});

test('_escapeHtml is defined exactly once and escapes quotes for attribute contexts', () => {
  // 클래스 내 메서드가 중복 정의되면 나중 정의가 프로토타입을 덮어써
  // 레이어 이름 title 속성의 따옴표 이스케이프가 무력화된다(속성 주입 방지).
  const defs = timelineSource.match(/^  _escapeHtml\(/gm) || [];
  assert.equal(defs.length, 1, '_escapeHtml는 정확히 1회만 정의되어야 함');
  // 남은 정의는 따옴표까지 이스케이프하는 정규식 버전이어야 함
  assert.match(timelineSource, /_escapeHtml\(value\)\s*\{[\s\S]*?replace\(\/"\/g, '&quot;'\)[\s\S]*?replace\(\/'\/g, '&#39;'\)/);
  // DOM(textContent) 기반 버전은 따옴표를 이스케이프하지 못하므로 존재해선 안 됨
  assert.doesNotMatch(timelineSource, /_escapeHtml\(text\)\s*\{[\s\S]*?div\.textContent/);
});
