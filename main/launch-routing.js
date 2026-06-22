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

function safeDecodeQueryComponent(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%20'));
  } catch {
    return null;
  }
}

function getQueryFilePath(query) {
  const pairs = query.split('&');
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=');
    const rawKey = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex);
    const decodedKey = safeDecodeQueryComponent(rawKey);
    if (decodedKey !== 'file') {
      continue;
    }

    const rawValue = separatorIndex === -1 ? '' : pair.slice(separatorIndex + 1);
    if (safeDecodeQueryComponent(rawValue) === null) {
      return '';
    }

    return new URLSearchParams(query).get('file') || '';
  }

  return '';
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
  let shouldDecodePath = true;

  if (rest.startsWith('/?')) {
    rawPath = getQueryFilePath(rest.slice(2));
    shouldDecodePath = false;
  } else if (rest.toLowerCase().startsWith('/%3f')) {
    rawPath = getQueryFilePath(rest.slice(4));
    shouldDecodePath = false;
  } else if (rest.startsWith('/')) {
    rawPath = rest.slice(1);
  } else if (rest.startsWith('?')) {
    rawPath = getQueryFilePath(rest.slice(1));
    shouldDecodePath = false;
  } else if (rest.toLowerCase().startsWith('%3f')) {
    rawPath = getQueryFilePath(rest.slice(3));
    shouldDecodePath = false;
  } else {
    return { route: '', filePath: '' };
  }

  const decodedPath = shouldDecodePath ? safeDecodeURIComponent(rawPath) : rawPath;
  if (!decodedPath) {
    return { route: '', filePath: '' };
  }

  return { route: routeName, filePath: normalizeLaunchPath(decodedPath) };
}

function classifyLaunchArgument(arg) {
  if (typeof arg !== 'string' || arg.length === 0) {
    return '';
  }

  const openRoute = resolveRoutedFileUrl(arg, 'open');
  if (openRoute.filePath) {
    if (hasExtension(openRoute.filePath, '.bcutlist')) {
      return 'cutlist';
    }
    if (hasExtension(openRoute.filePath, '.bplaylist')) {
      return 'playlist';
    }
    if (hasExtension(openRoute.filePath, '.bframe')) {
      return 'project';
    }
    if (isSupportedVideoPath(openRoute.filePath)) {
      return 'video';
    }
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
