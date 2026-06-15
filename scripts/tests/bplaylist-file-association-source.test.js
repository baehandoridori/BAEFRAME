const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8').replace(/\r\n/g, '\n');

const builderConfig = read('electron-builder.yml');
const installScript = read('integration/installer/install-integration.ps1');
const detectScript = read('integration/installer/detect-integration.ps1');
const uninstallScript = read('integration/installer/uninstall-integration.ps1');

test('electron builder registers saved playlist files as BAEFRAME project files', () => {
  assert.match(builderConfig, /fileAssociations:[\s\S]+ext: bframe/);
  assert.match(builderConfig, /fileAssociations:[\s\S]+ext: bplaylist/);
  assert.match(builderConfig, /ext: bplaylist[\s\S]+name: BAEFRAME Playlist/);
  assert.match(builderConfig, /ext: bplaylist[\s\S]+description: BAEFRAME Playlist File/);
});

test('team integration installer registers bplaylist double-click file association', () => {
  assert.match(installScript, /\$ProjectFileAssociations = @\(/);
  assert.match(installScript, /extension = '\.bplaylist'/);
  assert.match(installScript, /progId = 'BAEFRAME\.Playlist'/);
  assert.match(installScript, /Register-ProjectFileAssociations -ResolvedAppPath \$resolvedAppPath/);
  assert.match(installScript, /Registry::HKEY_CURRENT_USER\\Software\\Classes\\\$extension/);
  assert.match(installScript, /Registry::HKEY_CURRENT_USER\\Software\\Classes\\\$progId\\shell\\open\\command/);
  assert.match(installScript, /\$escapedCommand = "`"\$ResolvedAppPath`" `"%1`""/);
});

test('integration diagnostics report bplaylist project file association status', () => {
  assert.match(detectScript, /\$ProjectFileAssociations = @\(/);
  assert.match(detectScript, /extension = '\.bplaylist'/);
  assert.match(detectScript, /projectFiles = \[ordered\]@{/);
  assert.match(detectScript, /missingProjectFiles = \$missingProjectFiles/);
  assert.match(detectScript, /installed = \$projectFileInstalled/);
  assert.match(detectScript, /\$installed = \$sparseInstalled -or \$registryInstalled -or \$legacyInstalled/);
  assert.doesNotMatch(detectScript, /\$installed = [^\n]*\$projectFileInstalled/);
  assert.doesNotMatch(detectScript, /mode = 'project-files'/);
});

test('integration uninstaller removes bplaylist project file association', () => {
  assert.match(uninstallScript, /\$ProjectFileAssociations = @\(/);
  assert.match(uninstallScript, /extension = '\.bplaylist'/);
  assert.match(uninstallScript, /Remove-ProjectFileAssociations/);
  assert.match(uninstallScript, /Registry::HKEY_CURRENT_USER\\Software\\Classes\\\$extension/);
  assert.match(uninstallScript, /Registry::HKEY_CURRENT_USER\\Software\\Classes\\\$progId/);
});
