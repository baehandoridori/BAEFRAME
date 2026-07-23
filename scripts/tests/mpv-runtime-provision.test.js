const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  beforePack,
  ensureWindowsFfmpegRuntime,
  ensureWindowsMpvRuntime,
  resolveGitCommonDir,
  resolveMainCheckoutDir
} = require('../../scripts/electron-builder-before-pack');

function createSandbox(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-mpv-provision-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  const mainCheckoutDir = path.join(rootDir, 'main');
  const gitCommonDir = path.join(mainCheckoutDir, '.git');
  const worktreeDir = path.join(rootDir, 'worktree');

  fs.mkdirSync(gitCommonDir, { recursive: true });
  fs.mkdirSync(path.join(worktreeDir, 'mpv'), { recursive: true });
  fs.writeFileSync(path.join(worktreeDir, 'mpv', 'README.md'), 'tracked placeholder');

  return { mainCheckoutDir, gitCommonDir, worktreeDir };
}

function writeRuntimeDirectory(runtimeDir, prefix = 'fake') {
  fs.mkdirSync(path.join(runtimeDir, 'mpv'), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'mpv.exe'), `${prefix}-mpv-executable`);
  fs.writeFileSync(path.join(runtimeDir, 'mpv.com'), `${prefix}-mpv-console`);
  fs.writeFileSync(path.join(runtimeDir, 'd3dcompiler_43.dll'), `${prefix}-d3d-compiler`);
  fs.writeFileSync(path.join(runtimeDir, 'mpv', 'fonts.conf'), `${prefix}-font-config`);
  return runtimeDir;
}

function writeFakeRuntime(mainCheckoutDir) {
  return writeRuntimeDirectory(path.join(mainCheckoutDir, 'mpv', 'win32'));
}

function writeFfmpegRuntime(projectDir) {
  const runtimeDir = path.join(projectDir, 'ffmpeg', 'win32');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'ffmpeg.exe'), 'fake-ffmpeg-executable');
  fs.writeFileSync(path.join(runtimeDir, 'ffprobe.exe'), 'fake-ffprobe-executable');
  return runtimeDir;
}

test('copies the complete Windows mpv runtime from the main checkout into a linked worktree', (t) => {
  const { mainCheckoutDir, gitCommonDir, worktreeDir } = createSandbox(t);
  const sourceDir = writeFakeRuntime(mainCheckoutDir);

  const result = ensureWindowsMpvRuntime({
    projectDir: worktreeDir,
    gitCommonDir,
    env: {}
  });

  const targetDir = path.join(worktreeDir, 'mpv', 'win32');
  assert.equal(result.status, 'provisioned');
  assert.equal(result.sourceDir, sourceDir);
  assert.equal(fs.readFileSync(path.join(targetDir, 'mpv.exe'), 'utf8'), 'fake-mpv-executable');
  assert.equal(fs.readFileSync(path.join(targetDir, 'mpv.com'), 'utf8'), 'fake-mpv-console');
  assert.equal(fs.readFileSync(path.join(targetDir, 'd3dcompiler_43.dll'), 'utf8'), 'fake-d3d-compiler');
  assert.equal(fs.readFileSync(path.join(targetDir, 'mpv', 'fonts.conf'), 'utf8'), 'fake-font-config');
});

test('keeps an already prepared worktree runtime without overwriting it', (t) => {
  const { mainCheckoutDir, gitCommonDir, worktreeDir } = createSandbox(t);
  writeFakeRuntime(mainCheckoutDir);
  const localRuntimeDir = path.join(worktreeDir, 'mpv', 'win32');
  writeRuntimeDirectory(localRuntimeDir, 'local');

  const result = ensureWindowsMpvRuntime({
    projectDir: worktreeDir,
    gitCommonDir,
    env: {}
  });

  assert.equal(result.status, 'present');
  assert.equal(fs.readFileSync(path.join(localRuntimeDir, 'mpv.exe'), 'utf8'), 'local-mpv-executable');
});

test('rejects an incomplete local runtime without overwriting its existing files', (t) => {
  const { mainCheckoutDir, gitCommonDir, worktreeDir } = createSandbox(t);
  writeFakeRuntime(mainCheckoutDir);
  const localRuntimeDir = path.join(worktreeDir, 'mpv', 'win32');
  fs.mkdirSync(localRuntimeDir, { recursive: true });
  fs.writeFileSync(path.join(localRuntimeDir, 'mpv.exe'), 'incomplete-local-mpv');

  assert.throws(
    () => ensureWindowsMpvRuntime({
      projectDir: worktreeDir,
      gitCommonDir,
      env: {}
    }),
    /incomplete local Windows mpv runtime[\s\S]*refusing to overwrite or mix runtime versions/i
  );
  assert.equal(fs.readFileSync(path.join(localRuntimeDir, 'mpv.exe'), 'utf8'), 'incomplete-local-mpv');
  assert.equal(fs.existsSync(path.join(localRuntimeDir, 'mpv.com')), false);
});

test('accepts an explicit runtime source directory for CI and non-worktree builds', (t) => {
  const { gitCommonDir, worktreeDir } = createSandbox(t);
  const explicitSourceDir = path.join(path.dirname(worktreeDir), 'explicit-mpv-runtime');
  writeRuntimeDirectory(explicitSourceDir, 'explicit');

  const result = ensureWindowsMpvRuntime({
    projectDir: worktreeDir,
    gitCommonDir,
    env: { BAEFRAME_MPV_SOURCE_DIR: explicitSourceDir }
  });

  assert.equal(result.status, 'provisioned');
  assert.equal(result.sourceDir, explicitSourceDir);
  assert.equal(
    fs.readFileSync(path.join(worktreeDir, 'mpv', 'win32', 'mpv.exe'), 'utf8'),
    'explicit-mpv-executable'
  );
});

test('rejects an explicit runtime source that is missing required companion files', (t) => {
  const { mainCheckoutDir, gitCommonDir, worktreeDir } = createSandbox(t);
  writeFakeRuntime(mainCheckoutDir);
  const explicitSourceDir = path.join(path.dirname(worktreeDir), 'incomplete-explicit-runtime');
  fs.mkdirSync(explicitSourceDir, { recursive: true });
  fs.writeFileSync(path.join(explicitSourceDir, 'mpv.exe'), 'incomplete-explicit-mpv');

  assert.throws(
    () => ensureWindowsMpvRuntime({
      projectDir: worktreeDir,
      gitCommonDir,
      env: { BAEFRAME_MPV_SOURCE_DIR: explicitSourceDir }
    }),
    /Windows mpv runtime is missing[\s\S]*mpv\.com[\s\S]*d3dcompiler_43\.dll[\s\S]*fonts\.conf/
  );
});

test('rejects required runtime entries that are empty files', (t) => {
  const { gitCommonDir, worktreeDir } = createSandbox(t);
  const explicitSourceDir = path.join(path.dirname(worktreeDir), 'empty-file-runtime');
  writeRuntimeDirectory(explicitSourceDir, 'explicit');
  fs.writeFileSync(path.join(explicitSourceDir, 'mpv.com'), '');

  assert.throws(
    () => ensureWindowsMpvRuntime({
      projectDir: worktreeDir,
      gitCommonDir,
      env: { BAEFRAME_MPV_SOURCE_DIR: explicitSourceDir }
    }),
    /Windows mpv runtime is missing[\s\S]*mpv\.com/
  );
});

test('resolves the real Git common directory for a linked worktree', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-mpv-git-worktree-'));
  const mainCheckoutDir = path.join(rootDir, 'main');
  const linkedWorktreeDir = path.join(rootDir, 'linked');
  fs.mkdirSync(mainCheckoutDir, { recursive: true });

  execFileSync('git', ['init'], { cwd: mainCheckoutDir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=BAEFRAME Test', '-c', 'user.email=test@baeframe.local', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: mainCheckoutDir, stdio: 'ignore' }
  );
  execFileSync('git', ['worktree', 'add', '-b', 'linked-test', linkedWorktreeDir], {
    cwd: mainCheckoutDir,
    stdio: 'ignore'
  });
  t.after(() => {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', linkedWorktreeDir], {
        cwd: mainCheckoutDir,
        stdio: 'ignore'
      });
    } catch (_error) {
      // Temporary test cleanup falls back to removing the sandbox below.
    }
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  const gitCommonDir = resolveGitCommonDir(linkedWorktreeDir);
  assert.equal(gitCommonDir, path.join(mainCheckoutDir, '.git'));
  assert.equal(resolveMainCheckoutDir(gitCommonDir), mainCheckoutDir);
});

test('fails before packaging when no Windows mpv runtime can be found', (t) => {
  const { gitCommonDir, worktreeDir } = createSandbox(t);

  assert.throws(
    () => ensureWindowsMpvRuntime({ projectDir: worktreeDir, gitCommonDir, env: {} }),
    /Windows mpv runtime is missing[\s\S]*BAEFRAME_MPV_SOURCE_DIR/
  );
});

test('accepts complete non-empty Windows FFmpeg tools from the project runtime directory', (t) => {
  const { worktreeDir } = createSandbox(t);
  const runtimeDir = writeFfmpegRuntime(worktreeDir);

  const result = ensureWindowsFfmpegRuntime({ projectDir: worktreeDir });

  assert.equal(result.status, 'present');
  assert.equal(result.runtimeDir, runtimeDir);
});

test('rejects a Windows FFmpeg runtime when either executable is missing', (t) => {
  const { worktreeDir } = createSandbox(t);
  const runtimeDir = writeFfmpegRuntime(worktreeDir);
  fs.rmSync(path.join(runtimeDir, 'ffprobe.exe'));

  assert.throws(
    () => ensureWindowsFfmpegRuntime({ projectDir: worktreeDir }),
    /Windows FFmpeg runtime is incomplete[\s\S]*ffprobe\.exe[\s\S]*packaging was stopped/i
  );
});

test('rejects empty Windows FFmpeg executables', (t) => {
  const { worktreeDir } = createSandbox(t);
  const runtimeDir = writeFfmpegRuntime(worktreeDir);
  fs.writeFileSync(path.join(runtimeDir, 'ffmpeg.exe'), '');

  assert.throws(
    () => ensureWindowsFfmpegRuntime({ projectDir: worktreeDir }),
    /Windows FFmpeg runtime is incomplete[\s\S]*ffmpeg\.exe[\s\S]*non-empty regular files/i
  );
});

test('rejects Windows FFmpeg runtime entries that are not regular files', (t) => {
  const { worktreeDir } = createSandbox(t);
  const runtimeDir = writeFfmpegRuntime(worktreeDir);
  fs.rmSync(path.join(runtimeDir, 'ffprobe.exe'));
  fs.mkdirSync(path.join(runtimeDir, 'ffprobe.exe'));

  assert.throws(
    () => ensureWindowsFfmpegRuntime({ projectDir: worktreeDir }),
    /Windows FFmpeg runtime is incomplete[\s\S]*ffprobe\.exe[\s\S]*non-empty regular files/i
  );
});

test('Windows beforePack stops before building a package with missing FFmpeg tools', async (t) => {
  const { worktreeDir } = createSandbox(t);
  writeRuntimeDirectory(path.join(worktreeDir, 'mpv', 'win32'));

  await assert.rejects(
    () => beforePack({
      electronPlatformName: 'win32',
      packager: { projectDir: worktreeDir }
    }),
    /Windows FFmpeg runtime is incomplete[\s\S]*packaging was stopped/i
  );
});

test('electron-builder hook skips non-Windows targets', async (t) => {
  const { worktreeDir } = createSandbox(t);

  const result = await beforePack({
    electronPlatformName: 'darwin',
    packager: { projectDir: worktreeDir }
  });

  assert.equal(result.status, 'skipped');
});

test('electron-builder config wires mpv provisioning before pack and runtime marker cleanup after pack', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const builderConfig = fs.readFileSync(path.join(rootDir, 'electron-builder.yml'), 'utf8');

  assert.match(builderConfig, /^beforePack:\s*\.\/scripts\/electron-builder-before-pack\.js$/m);
  assert.match(builderConfig, /^afterPack:\s*\.\/scripts\/electron-builder-after-pack\.js$/m);
});

test('the standard mpv test command includes the packaging regression', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  assert.match(packageJson.scripts['test:mpv'], /mpv-runtime-provision\.test\.js/);
  assert.match(packageJson.scripts['test:mpv'], /runtime-profile\.test\.js/);
});
