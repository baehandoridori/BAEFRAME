'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectDir = path.resolve(__dirname, '..');
const sourcePath = path.join(
  projectDir,
  'native',
  'review-file-cas-helper',
  'ReviewFileCasHelper.cs'
);
const outputDir = path.join(
  projectDir,
  'native',
  'review-file-cas-helper',
  'bin'
);
const outputPath = path.join(outputDir, 'ReviewFileCasHelper.exe');

function findCompiler({
  windowsDirectory = process.env.WINDIR || 'C:\\Windows',
  fsModule = fs
} = {}) {
  const candidates = [
    path.join(
      windowsDirectory,
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe'
    ),
    path.join(
      windowsDirectory,
      'Microsoft.NET',
      'Framework',
      'v4.0.30319',
      'csc.exe'
    )
  ];
  return candidates.find(candidate => fsModule.existsSync(candidate)) || null;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function runHelperSmokeTest(executablePath, fsModule = fs) {
  const directory = fsModule.mkdtempSync(
    path.join(os.tmpdir(), 'baeframe-review-cas-build-')
  );
  const targetPath = path.join(directory, 'review.bframe');
  const replacementPath = path.join(directory, 'replacement.tmp');
  const createTargetPath = path.join(directory, 'created.bframe');
  const createReplacementPath = path.join(directory, 'create.tmp');
  const base = '{"revision":1}\n';
  const next = '{"revision":2}\n';
  const created = '{"revision":1,"created":true}\n';

  try {
    fsModule.writeFileSync(targetPath, base, 'utf8');
    fsModule.writeFileSync(replacementPath, next, 'utf8');
    const replaceResult = spawnSync(executablePath, [
      targetPath,
      replacementPath,
      sha256(base),
      sha256(next),
      '1000'
    ], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (replaceResult.status !== 0 ||
        fsModule.readFileSync(targetPath, 'utf8') !== next) {
      throw new Error(
        'review-file CAS helper replace smoke test failed: ' +
        `${replaceResult.stderr || replaceResult.stdout}`
      );
    }

    fsModule.writeFileSync(createReplacementPath, created, 'utf8');
    const createResult = spawnSync(executablePath, [
      createTargetPath,
      createReplacementPath,
      '__ABSENT__',
      sha256(created),
      '1000'
    ], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (createResult.status !== 0 ||
        fsModule.readFileSync(createTargetPath, 'utf8') !== created) {
      throw new Error(
        'review-file CAS helper create smoke test failed: ' +
        `${createResult.stderr || createResult.stdout}`
      );
    }
  } finally {
    fsModule.rmSync(directory, { recursive: true, force: true });
  }
}

function buildReviewFileCasHelper({
  platform = process.platform,
  fsModule = fs
} = {}) {
  if (platform !== 'win32') {
    return { status: 'skipped', reason: 'windows-only' };
  }

  const compilerPath = findCompiler({ fsModule });
  if (!compilerPath) {
    throw new Error(
      'Windows .NET Framework C# compiler was not found; ' +
      'the review-file CAS helper cannot be built safely.'
    );
  }

  fsModule.mkdirSync(outputDir, { recursive: true });
  const compileResult = spawnSync(compilerPath, [
    '/nologo',
    '/optimize+',
    '/target:exe',
    `/out:${outputPath}`,
    sourcePath
  ], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (compileResult.status !== 0) {
    throw new Error(
      'Review-file CAS helper compilation failed:\n' +
      `${compileResult.stdout || ''}${compileResult.stderr || ''}`
    );
  }

  runHelperSmokeTest(outputPath, fsModule);
  return {
    status: 'built',
    compilerPath,
    outputPath,
    sha256: sha256(fsModule.readFileSync(outputPath))
  };
}

if (require.main === module) {
  const result = buildReviewFileCasHelper();
  if (result.status === 'built') {
    console.log(
      `[review-file-cas] built ${result.outputPath} (${result.sha256})`
    );
  }
}

module.exports = {
  buildReviewFileCasHelper,
  findCompiler,
  outputPath,
  runHelperSmokeTest,
  sha256,
  sourcePath
};
