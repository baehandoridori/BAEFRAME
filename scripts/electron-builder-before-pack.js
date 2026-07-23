const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  buildReviewFileCasHelper
} = require('./build-review-file-cas-helper');

const REQUIRED_WINDOWS_MPV_FILES = Object.freeze([
  'mpv.exe',
  'mpv.com',
  'd3dcompiler_43.dll',
  path.join('mpv', 'fonts.conf')
]);

const REQUIRED_WINDOWS_FFMPEG_FILES = Object.freeze([
  'ffmpeg.exe',
  'ffprobe.exe'
]);

function getMissingRuntimeFiles(runtimeDir) {
  return REQUIRED_WINDOWS_MPV_FILES.filter(relativePath => {
    try {
      const stats = fs.statSync(path.join(runtimeDir, relativePath));
      return !stats.isFile() || stats.size <= 0;
    } catch (_error) {
      return true;
    }
  });
}

function ensureWindowsFfmpegRuntime({ projectDir }) {
  const runtimeDir = path.join(path.resolve(projectDir), 'ffmpeg', 'win32');
  const invalidFiles = REQUIRED_WINDOWS_FFMPEG_FILES.filter(fileName => {
    try {
      const stats = fs.statSync(path.join(runtimeDir, fileName));
      return !stats.isFile() || stats.size <= 0;
    } catch (_error) {
      return true;
    }
  });

  if (invalidFiles.length > 0) {
    throw new Error(
      [
        `Windows FFmpeg runtime is incomplete at ${runtimeDir}.`,
        `Missing, empty, or non-file entries: ${invalidFiles.join(', ')}`,
        'Packaging was stopped before creating a build without video conversion tools.',
        'ffmpeg.exe and ffprobe.exe must both be non-empty regular files in ffmpeg/win32.'
      ].join('\n')
    );
  }

  return { status: 'present', runtimeDir };
}

function resolveGitCommonDir(projectDir) {
  try {
    const output = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: projectDir,
        encoding: 'utf8',
        windowsHide: true
      }
    ).trim();

    return output ? path.resolve(projectDir, output) : null;
  } catch (_error) {
    return null;
  }
}

function resolveMainCheckoutDir(gitCommonDir) {
  if (!gitCommonDir) return null;
  return path.basename(gitCommonDir).toLowerCase() === '.git'
    ? path.dirname(gitCommonDir)
    : gitCommonDir;
}

function resolveSourceDirectories({ projectDir, gitCommonDir, env }) {
  const explicitSourceDir = String(env.BAEFRAME_MPV_SOURCE_DIR || '').trim();
  if (explicitSourceDir) {
    return [path.resolve(projectDir, explicitSourceDir)];
  }

  const candidates = [];
  const mainCheckoutDir = resolveMainCheckoutDir(
    gitCommonDir || resolveGitCommonDir(projectDir)
  );
  if (mainCheckoutDir) {
    candidates.push(path.join(mainCheckoutDir, 'mpv', 'win32'));
  }

  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function ensureWindowsMpvRuntime({
  projectDir,
  gitCommonDir = null,
  env = process.env
}) {
  const resolvedProjectDir = path.resolve(projectDir);
  const targetDir = path.join(resolvedProjectDir, 'mpv', 'win32');
  const missingTargetFiles = getMissingRuntimeFiles(targetDir);

  if (missingTargetFiles.length === 0) {
    return { status: 'present', sourceDir: targetDir, targetDir };
  }

  if (missingTargetFiles.length < REQUIRED_WINDOWS_MPV_FILES.length) {
    throw new Error(
      [
        `Found an incomplete local Windows mpv runtime at ${targetDir}.`,
        `Missing: ${missingTargetFiles.join(', ')}`,
        'Packaging is refusing to overwrite or mix runtime versions.',
        'Restore the missing files from the same mpv build, or remove the incomplete mpv/win32 folder so it can be provisioned cleanly.'
      ].join('\n')
    );
  }

  const sourceDirectories = resolveSourceDirectories({
    projectDir: resolvedProjectDir,
    gitCommonDir,
    env
  });
  const sourceChecks = sourceDirectories.map(sourceDir => ({
    sourceDir,
    missingFiles: getMissingRuntimeFiles(sourceDir)
  }));
  const completeSource = sourceChecks.find(candidate => candidate.missingFiles.length === 0);
  const sourceDir = completeSource?.sourceDir;

  if (!sourceDir) {
    const searched = sourceChecks.length > 0
      ? sourceChecks.map(candidate => (
        `  - ${candidate.sourceDir} (missing: ${candidate.missingFiles.join(', ')})`
      )).join('\n')
      : '  - no Git main checkout could be resolved';
    throw new Error(
      [
        'Windows mpv runtime is missing; packaging was stopped before creating a broken build.',
        `Expected target: ${path.join(targetDir, 'mpv.exe')}`,
        'Searched runtime sources:',
        searched,
        'Copy the runtime to the main checkout mpv/win32 folder or set BAEFRAME_MPV_SOURCE_DIR.'
      ].join('\n')
    );
  }

  for (const relativePath of REQUIRED_WINDOWS_MPV_FILES) {
    const sourcePath = path.join(sourceDir, relativePath);
    const targetPath = path.join(targetDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  }

  const missingProvisionedFiles = getMissingRuntimeFiles(targetDir);
  if (missingProvisionedFiles.length > 0) {
    throw new Error(
      `Failed to provision complete Windows mpv runtime at ${targetDir}; missing: ${missingProvisionedFiles.join(', ')}`
    );
  }

  return { status: 'provisioned', sourceDir, targetDir };
}

async function beforePack(context) {
  if (context.electronPlatformName !== 'win32') {
    return { status: 'skipped' };
  }

  const result = ensureWindowsMpvRuntime({
    projectDir: context.packager.projectDir
  });
  const ffmpeg = ensureWindowsFfmpegRuntime({
    projectDir: context.packager.projectDir
  });
  const casHelper = buildReviewFileCasHelper();

  if (result.status === 'provisioned') {
    console.log(`[beforePack] Prepared Windows mpv runtime from ${result.sourceDir}`);
  }

  return {
    ...result,
    ffmpeg,
    casHelper
  };
}

module.exports = {
  beforePack,
  ensureWindowsFfmpegRuntime,
  ensureWindowsMpvRuntime,
  getMissingRuntimeFiles,
  resolveGitCommonDir,
  resolveMainCheckoutDir,
  REQUIRED_WINDOWS_FFMPEG_FILES,
  REQUIRED_WINDOWS_MPV_FILES
};
