const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const scriptPath = path.resolve(__dirname, '../archive-release-copies.ps1');
const executable = 'BFRAME_alpha_v2.exe';
const archiveName = '배포 백업 (실행 불가)';
const candidates = [
  '테스트버전 빌드.__backup_pre-2.12.5-beta_20260921-191003',
  '테스트버전 빌드.__retired_pre-2.12.3-beta_20260915-202123',
  '테스트버전 빌드.__staging_2.12.1-beta_20260914-073810',
  '테스트버전 빌드.backup-2.2.0-before-2.2.1-20260825-140208',
  '테스트버전 빌드 2.10.0-beta',
  '테스트버전 빌드.__backup_2.1.0-beta_20260821_173537',
  '.__backup_2.1.0-beta_20260821_173537',
  '검증용-review-playback-input-20260914'
];

function fixture(names = candidates) {
  // Keep these tiny fixtures as inspection evidence; never recursively delete paths.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-archive-smoke-'));
  for (const name of names) {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(dir, executable), `not executable: ${name}`);
    fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'fixture-asar');
    fs.writeFileSync(path.join(dir, 'resources', 'profile.json'), '{"fixture":true}');
  }
  return root;
}

function quote(value) { return `'${value.replaceAll("'", "''")}'`; }

function run(root, { apply = false, setup = '', reportPath = '', finish = '' } = {}) {
  assert.ok(fs.existsSync(scriptPath), 'an archive script must exist before copying any release');
  const command = `${setup}\n& ${quote(scriptPath)} -DeploymentRoot ${quote(root)} ${apply ? '-Apply' : ''} ${reportPath ? `-ReportPath ${quote(reportPath)}` : ''}\n$scriptExit = $LASTEXITCODE\n${finish}\nexit $scriptExit`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.error, undefined, result.error?.message);
  const output = result.stdout.trim().replace(/^\uFEFF/, '');
  let report;
  try { report = JSON.parse(output); } catch { assert.fail(`Expected JSON report, got ${output}\n${result.stderr}`); }
  return { ...result, report };
}

function hash(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase(); }

test('dry run selects only named deployment copies and leaves executable names and directories intact', { skip: process.platform !== 'win32' }, () => {
  const ignored = ['테스트버전 빌드', 'my backup folder', '테스트버전 빌드.__backup_notes', '검증용-review-playback-input-20260915'];
  const root = fixture([...candidates, ...ignored]);
  fs.mkdirSync(path.join(root, '테스트버전 빌드.__backup_20260101-010101'));
  const result = run(root);
  assert.equal(result.status, 0, JSON.stringify(result.report));
  assert.equal(result.report.status, 'dry-run');
  assert.deepEqual(result.report.items.map(item => item.name).sort(), [...candidates].sort());
  assert.equal(fs.existsSync(path.join(root, archiveName)), false);
  for (const name of [...candidates, ...ignored]) assert.equal(fs.existsSync(path.join(root, name, executable)), true);
});

test('apply disables entry executables then archives all candidates with matching hashes counts and bytes', { skip: process.platform !== 'win32' }, () => {
  const root = fixture();
  const hashes = new Map(candidates.map(name => [name, hash(path.join(root, name, executable))]));
  const reportPath = path.join(root, 'archive-report.json');
  const result = run(root, { apply: true, reportPath });
  assert.equal(result.status, 0, JSON.stringify(result.report));
  assert.equal(result.report.status, 'completed');
  assert.equal(result.report.items.length, candidates.length);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), result.report);
  for (const item of result.report.items) {
    const archived = path.join(root, archiveName, item.name);
    assert.equal(fs.existsSync(path.join(root, item.name)), false);
    assert.equal(fs.existsSync(path.join(archived, executable)), false);
    assert.equal(hash(path.join(archived, `${executable}.disabled`)), hashes.get(item.name));
    assert.equal(item.before.fileCount, 3);
    assert.equal(item.after.fileCount, item.before.fileCount);
    assert.equal(item.after.bytes, item.before.bytes);
    assert.equal(item.exeSha256Before, item.exeSha256After);
    assert.equal(item.state, 'archived');
  }
  const repeat = run(root, { apply: true });
  assert.equal(repeat.status, 0);
  assert.equal(repeat.report.items.length, 0);
});

test('running app detection stops the entire batch before any executable rename', { skip: process.platform !== 'win32' }, () => {
  const root = fixture(candidates.slice(0, 2));
  const running = path.join(root, candidates[1], executable);
  const result = run(root, { apply: true, setup: `function Get-CimInstance { [pscustomobject]@{ ProcessId = 321; Name = '${executable}'; ExecutablePath = ${quote(running)} } }` });
  assert.equal(result.status, 1);
  assert.equal(result.report.status, 'failed');
  assert.match(result.report.error, /running process/i);
  assert.equal(fs.existsSync(path.join(root, archiveName)), false);
  for (const name of candidates.slice(0, 2)) assert.equal(fs.existsSync(path.join(root, name, executable)), true);
});

test('destination collisions and disabled-name collisions fail without touching other candidates', { skip: process.platform !== 'win32' }, () => {
  for (const collision of ['directory', 'disabled']) {
    const root = fixture(candidates.slice(0, 2));
    if (collision === 'directory') fs.mkdirSync(path.join(root, archiveName, candidates[1]), { recursive: true });
    else fs.writeFileSync(path.join(root, candidates[1], `${executable}.disabled`), 'existing');
    const result = run(root, { apply: true });
    assert.equal(result.status, 1);
    assert.match(result.report.error, /collision/i);
    for (const name of candidates.slice(0, 2)) assert.equal(fs.existsSync(path.join(root, name, executable)), true);
  }
});

test('reparse directories under a candidate are rejected without following or moving them', { skip: process.platform !== 'win32' }, () => {
  const root = fixture(candidates.slice(0, 1));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-archive-outside-'));
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'untouched');
  fs.symlinkSync(outside, path.join(root, candidates[0], 'linked'), 'junction');
  const result = run(root, { apply: true });
  assert.equal(result.status, 1);
  assert.match(result.report.error, /reparse/i);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'untouched');
  assert.equal(fs.existsSync(path.join(root, candidates[0], executable)), true);
});

test('a rename failure safely rolls back previously moved copies', { skip: process.platform !== 'win32' }, () => {
  const names = [...candidates.slice(0, 2)].sort();
  const root = fixture(names);
  const locked = path.join(root, names[1], executable);
  const result = run(root, {
    apply: true,
    setup: `$fixtureLock = [System.IO.File]::Open(${quote(locked)}, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)`,
    finish: '$fixtureLock.Dispose()'
  });
  assert.equal(result.status, 1);
  assert.equal(result.report.status, 'failed');
  assert.deepEqual(result.report.rollbackErrors, []);
  assert.equal(result.report.items.some(item => item.state === 'rolled-back'), true, JSON.stringify(result.report));
  for (const name of names) {
    assert.equal(fs.existsSync(path.join(root, name, executable)), true);
    assert.equal(fs.existsSync(path.join(root, archiveName, name)), false);
  }
});

test('entry executable casing is preserved and report collisions never overwrite an existing file', { skip: process.platform !== 'win32' }, () => {
  const root = fixture(candidates.slice(0, 1));
  const original = path.join(root, candidates[0], executable);
  const lowercase = executable.toLowerCase();
  fs.renameSync(original, path.join(root, candidates[0], 'temporary-name'));
  fs.renameSync(path.join(root, candidates[0], 'temporary-name'), path.join(root, candidates[0], lowercase));
  const reportPath = path.join(root, 'existing-report.json');
  fs.writeFileSync(reportPath, 'existing report');
  const failed = run(root, { apply: true, reportPath });
  assert.equal(failed.status, 1);
  assert.equal(fs.readFileSync(reportPath, 'utf8'), 'existing report');
  assert.equal(fs.existsSync(path.join(root, candidates[0], lowercase)), true);
  const result = run(root, { apply: true });
  assert.equal(result.status, 0, JSON.stringify(result.report));
  assert.ok(fs.readdirSync(path.join(root, archiveName, candidates[0])).includes(`${lowercase}.disabled`));
});
