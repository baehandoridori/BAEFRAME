const path = require('path');

const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

function hasExtension(filePath, ext) {
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith(ext);
}

function isSupportedVideoPath(filePath) {
  return SUPPORTED_VIDEO_EXTENSIONS.some((ext) => hasExtension(filePath, ext));
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function normalizeLaunchPath(filePath, replaceSlashes = true) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return '';
  }

  let normalized = filePath;
  if (replaceSlashes) {
    normalized = normalized.replace(/\//g, '\\');
  }
  if (/^[A-Za-z][\/\\]/.test(normalized)) {
    normalized = normalized[0] + ':' + normalized.slice(1);
  }
  return path.win32.normalize(normalized);
}

function parseRoutedFileUrl(arg, routeName) {
  return resolveRoutedFileUrl(arg, routeName).filePath;
}

function resolveRoutedFileUrl(arg, routeName) {
  if (typeof arg !== 'string' || typeof routeName !== 'string' || !routeName) {
    return { route: '', filePath: '' };
  }

  const routePrefix = `baeframe://${routeName}`;
  if (!arg.toLowerCase().startsWith(routePrefix.toLowerCase())) {
    return { route: '', filePath: '' };
  }

  const rest = arg.slice(routePrefix.length);
  let rawPath = '';

  if (rest.startsWith('/')) {
    rawPath = rest.slice(1);
  } else if (rest.startsWith('?')) {
    const params = new URLSearchParams(rest.slice(1));
    rawPath = params.get('file') || '';
  } else if (rest.toLowerCase().startsWith('%3f')) {
    const params = new URLSearchParams(rest.slice(3));
    rawPath = params.get('file') || '';
  } else {
    return { route: '', filePath: '' };
  }

  const decodedPath = safeDecodeURIComponent(rawPath);
  if (!decodedPath) {
    return { route: '', filePath: '' };
  }

  return { route: routeName, filePath: normalizeLaunchPath(decodedPath) };
}

function classifyLaunchArgument(arg) {
  if (typeof arg !== 'string' || arg.length === 0) {
    return '';
  }

  const cutlistRoute = resolveRoutedFileUrl(arg, 'cutlist');
  if (cutlistRoute.filePath) {
    return 'cutlist';
  }

  const playlistRoute = resolveRoutedFileUrl(arg, 'playlist');
  if (playlistRoute.filePath) {
    return 'playlist';
  }

  if (hasExtension(arg, '.bcutlist')) {
    return 'cutlist';
  }
  if (hasExtension(arg, '.bplaylist')) {
    return 'playlist';
  }
  if (hasExtension(arg, '.bframe')) {
    return 'project';
  }
  if (isSupportedVideoPath(arg)) {
    return 'video';
  }
  if (arg.startsWith('baeframe://')) {
    return 'protocol';
  }

  return '';
}

function isLaunchArgument(arg) {
  return classifyLaunchArgument(arg) !== '';
}

module.exports = {
  SUPPORTED_VIDEO_EXTENSIONS,
  classifyLaunchArgument,
  hasExtension,
  isLaunchArgument,
  isSupportedVideoPath,
  normalizeLaunchPath,
  parseRoutedFileUrl,
  resolveRoutedFileUrl,
  safeDecodeURIComponent
};
