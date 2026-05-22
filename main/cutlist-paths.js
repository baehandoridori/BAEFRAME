const path = require('path');

function validateCutlistFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('컷 묶음 파일 경로가 올바르지 않습니다.');
  }

  const normalized = path.normalize(filePath);
  if (path.extname(normalized).toLowerCase() !== '.bcutlist') {
    throw new Error('컷 묶음 파일은 .bcutlist만 사용할 수 있습니다.');
  }

  return normalized;
}

module.exports = {
  validateCutlistFilePath
};
