const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const projectFileAssociations = require('../../main/project-file-associations');

const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8').replace(/\r\n/g, '\n');

test('project file association specs include bframe and bplaylist', () => {
  assert.deepEqual(
    projectFileAssociations.PROJECT_FILE_ASSOCIATIONS.map(spec => [spec.extension, spec.progId]),
    [
      ['.bframe', 'BAEFRAME.Review'],
      ['.bplaylist', 'BAEFRAME.Playlist']
    ]
  );
});

test('registry operations force bplaylist and bframe to open with the current exe', () => {
  const operations = projectFileAssociations.buildProjectFileAssociationOperations('C:\\BAEFRAME\\BFRAME_alpha_v2.exe');
  const commandValues = operations
    .filter(operation => operation.args.some(arg => arg.includes('shell\\open\\command')))
    .map(operation => operation.args.join(' '));

  assert.equal(commandValues.length, 2);
  assert.match(commandValues[0], /BAEFRAME\.Review\\shell\\open\\command/);
  assert.match(commandValues[0], /"C:\\BAEFRAME\\BFRAME_alpha_v2\.exe" "%1"/);
  assert.match(commandValues[1], /BAEFRAME\.Playlist\\shell\\open\\command/);
  assert.match(commandValues[1], /"C:\\BAEFRAME\\BFRAME_alpha_v2\.exe" "%1"/);

  assert.ok(operations.every(operation => operation.command === 'reg.exe'));
  assert.ok(operations.every(operation => operation.args.includes('/f')));
});

test('registry operations use packaged project file icon when available', () => {
  const operations = projectFileAssociations.buildProjectFileAssociationOperations(
    'C:\\BAEFRAME\\BFRAME_alpha_v2.exe',
    'C:\\BAEFRAME\\resources\\project-file.ico'
  );
  const iconValues = operations
    .filter(operation => operation.args.some(arg => arg.includes('DefaultIcon')))
    .map(operation => operation.args.join(' '));

  assert.equal(iconValues.length, 2);
  assert.match(iconValues[0], /BAEFRAME\.Review\\DefaultIcon/);
  assert.match(iconValues[0], /"C:\\BAEFRAME\\resources\\project-file\.ico",0/);
  assert.match(iconValues[1], /BAEFRAME\.Playlist\\DefaultIcon/);
  assert.match(iconValues[1], /"C:\\BAEFRAME\\resources\\project-file\.ico",0/);
});

test('auto registration runs only for packaged Windows apps and does not block startup on failure', async () => {
  const calls = [];
  const success = await projectFileAssociations.registerProjectFileAssociations({
    appPath: 'C:\\BAEFRAME\\BFRAME_alpha_v2.exe',
    platform: 'win32',
    isDefaultApp: false,
    runner: async (command, args) => {
      calls.push({ command, args });
    }
  });

  assert.equal(success.ok, true);
  assert.equal(calls.length, projectFileAssociations.buildProjectFileAssociationOperations('C:\\BAEFRAME\\BFRAME_alpha_v2.exe').length);

  const skippedDev = await projectFileAssociations.registerProjectFileAssociations({
    appPath: 'C:\\BAEFRAME\\BFRAME_alpha_v2.exe',
    platform: 'win32',
    isDefaultApp: true,
    runner: async () => {
      throw new Error('should not run');
    }
  });
  assert.equal(skippedDev.ok, false);
  assert.equal(skippedDev.skipped, true);
  assert.equal(skippedDev.reason, 'default-app');

  const failed = await projectFileAssociations.registerProjectFileAssociations({
    appPath: 'C:\\BAEFRAME\\BFRAME_alpha_v2.exe',
    platform: 'win32',
    isDefaultApp: false,
    runner: async () => {
      throw new Error('registry unavailable');
    }
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.skipped, false);
  assert.equal(failed.error.message, 'registry unavailable');
});

test('main process starts project file association repair during app startup', () => {
  const mainIndex = read('main/index.js');

  assert.match(mainIndex, /registerProjectFileAssociations/);
  assert.match(mainIndex, /app\.whenReady\(\)\.then/);
  assert.match(mainIndex, /appPath: process\.execPath/);
});
