const { execFile } = require('child_process');

const PROJECT_FILE_ASSOCIATIONS = [
  {
    extension: '.bframe',
    progId: 'BAEFRAME.Review',
    label: 'BAEFRAME Review File'
  },
  {
    extension: '.bplaylist',
    progId: 'BAEFRAME.Playlist',
    label: 'BAEFRAME Playlist File'
  }
];

function buildProjectFileAssociationOperations(appPath) {
  if (!appPath) {
    throw new Error('appPath is required');
  }

  return PROJECT_FILE_ASSOCIATIONS.flatMap(({ extension, progId, label }) => {
    const commandValue = `"${appPath}" "%1"`;
    const iconValue = `"${appPath}",0`;

    return [
      {
        command: 'reg.exe',
        args: ['ADD', `HKCU\\Software\\Classes\\${extension}`, '/ve', '/d', progId, '/f']
      },
      {
        command: 'reg.exe',
        args: ['ADD', `HKCU\\Software\\Classes\\${progId}`, '/ve', '/d', label, '/f']
      },
      {
        command: 'reg.exe',
        args: ['ADD', `HKCU\\Software\\Classes\\${progId}\\DefaultIcon`, '/ve', '/d', iconValue, '/f']
      },
      {
        command: 'reg.exe',
        args: ['ADD', `HKCU\\Software\\Classes\\${progId}\\shell\\open`, '/ve', '/d', 'Open', '/f']
      },
      {
        command: 'reg.exe',
        args: ['ADD', `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`, '/ve', '/d', commandValue, '/f']
      }
    ];
  });
}

function runRegistryCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function logResult(logger, level, message, meta) {
  if (!logger || typeof logger[level] !== 'function') {
    return;
  }

  logger[level](message, meta);
}

async function registerProjectFileAssociations({
  appPath = process.execPath,
  platform = process.platform,
  isDefaultApp = process.defaultApp,
  runner = runRegistryCommand,
  logger = null
} = {}) {
  if (platform !== 'win32') {
    return { ok: false, skipped: true, reason: 'non-windows' };
  }

  if (isDefaultApp) {
    return { ok: false, skipped: true, reason: 'default-app' };
  }

  let operations;
  try {
    operations = buildProjectFileAssociationOperations(appPath);
  } catch (error) {
    logResult(logger, 'warn', '프로젝트 파일 연결 준비 실패', { error: error.message });
    return { ok: false, skipped: false, error };
  }

  try {
    for (const operation of operations) {
      await runner(operation.command, operation.args);
    }

    logResult(logger, 'info', '프로젝트 파일 연결 자동 등록 완료', {
      appPath,
      extensions: PROJECT_FILE_ASSOCIATIONS.map(spec => spec.extension)
    });
    return { ok: true, skipped: false, operations: operations.length };
  } catch (error) {
    logResult(logger, 'warn', '프로젝트 파일 연결 자동 등록 실패', {
      appPath,
      error: error.message,
      stderr: error.stderr || ''
    });
    return { ok: false, skipped: false, error };
  }
}

module.exports = {
  PROJECT_FILE_ASSOCIATIONS,
  buildProjectFileAssociationOperations,
  registerProjectFileAssociations
};
