/**
 * Feedback import helpers.
 *
 * Copies comment feedback from one version into another without mutating either
 * source object. Drawing, highlight, and composition data are intentionally out
 * of scope for this module.
 */

import { migrateToV2 } from '../../../shared/schema.js';

function defaultCreateId(prefix = 'feedback') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clonePlainRecord(record) {
  if (!record || typeof record !== 'object') return {};
  return JSON.parse(JSON.stringify(record));
}

function getCommentLayers(comments) {
  const normalized = normalizeFeedbackComments(comments);
  return Array.isArray(normalized?.layers) ? normalized.layers : [];
}

function getMarkers(layer) {
  return Array.isArray(layer?.markers) ? layer.markers : [];
}

function getImportableMarkers(sourceComments) {
  return getCommentLayers(sourceComments)
    .flatMap(layer => getMarkers(layer))
    .filter(marker => marker && marker.deleted !== true);
}

function createDefaultTargetLayer(targetLayerId = 'comment-layer-1') {
  return {
    id: targetLayerId,
    name: '댓글 1',
    color: '#ff6b6b',
    visible: true,
    locked: false,
    markers: []
  };
}

function normalizeLegacyCommentArray(comments) {
  return {
    layers: [
      {
        id: 'layer_default',
        name: '기본 레이어',
        visible: true,
        markers: comments.map(comment => ({
          ...clonePlainRecord(comment),
          replies: Array.isArray(comment?.replies) ? comment.replies.map(reply => clonePlainRecord(reply)) : []
        }))
      }
    ]
  };
}

function normalizeFeedbackComments(comments) {
  if (comments && typeof comments === 'object' && Array.isArray(comments.layers)) {
    return comments;
  }

  if (Array.isArray(comments)) {
    return normalizeLegacyCommentArray(comments);
  }

  return { layers: [] };
}

/**
 * Normalize full source review data into importable v2 comment data.
 *
 * @param {object|Array|null} sourceData
 * @returns {object}
 */
export function normalizeFeedbackSourceComments(sourceData) {
  if (!sourceData || typeof sourceData !== 'object') {
    return { layers: [] };
  }

  if (Array.isArray(sourceData) || Array.isArray(sourceData.layers)) {
    return normalizeFeedbackComments(sourceData);
  }

  try {
    const migrated = migrateToV2(sourceData);
    return normalizeFeedbackComments(migrated?.comments);
  } catch (_error) {
    return normalizeFeedbackComments(sourceData.comments);
  }
}

function normalizeTargetComments(targetComments, targetLayerId) {
  const base = {
    ...clonePlainRecord(targetComments),
    layers: getCommentLayers(targetComments).map(layer => ({
      ...clonePlainRecord(layer),
      markers: getMarkers(layer).map(marker => clonePlainRecord(marker))
    }))
  };

  if (base.layers.length === 0) {
    base.layers.push(createDefaultTargetLayer(targetLayerId));
  }

  return base;
}

function resolveTargetLayer(comments, preferredLayerId) {
  if (!comments.layers.length) {
    comments.layers.push(createDefaultTargetLayer(preferredLayerId));
  }

  const preferred = preferredLayerId
    ? comments.layers.find(layer => layer.id === preferredLayerId)
    : null;

  return preferred || comments.layers[0];
}

/**
 * Count source comment markers that can be imported.
 *
 * @param {object|null} sourceComments
 * @returns {number}
 */
export function countImportableFeedbackMarkers(sourceComments) {
  return getImportableMarkers(sourceComments).length;
}

/**
 * Clone source feedback markers for insertion into a target comment layer.
 *
 * @param {object|null} sourceComments
 * @param {object} options
 * @param {(prefix: string) => string} options.createId
 * @param {string} options.targetLayerId
 * @returns {Array<object>}
 */
export function cloneFeedbackMarkers(sourceComments, options = {}) {
  const createId = options.createId || defaultCreateId;
  const targetLayerId = options.targetLayerId || 'comment-layer-1';

  return getImportableMarkers(sourceComments).map(sourceMarker => {
    const cloned = {
      ...clonePlainRecord(sourceMarker),
      id: createId('marker'),
      layerId: targetLayerId,
      replies: Array.isArray(sourceMarker.replies)
        ? sourceMarker.replies.map(reply => ({
          ...clonePlainRecord(reply),
          id: createId('reply')
        }))
        : []
    };

    delete cloned.element;
    delete cloned.tooltipElement;

    return cloned;
  });
}

/**
 * Import source feedback markers into a target comments object.
 *
 * @param {object|null} targetComments
 * @param {object|null} sourceComments
 * @param {object} options
 * @param {(prefix: string) => string} options.createId
 * @param {string} options.targetLayerId
 * @returns {{ comments: object, importedCount: number, importedMarkers: Array<object> }}
 */
export function importFeedbackIntoTargetComments(targetComments, sourceComments, options = {}) {
  const comments = normalizeTargetComments(targetComments, options.targetLayerId || 'comment-layer-1');
  const targetLayer = resolveTargetLayer(comments, options.targetLayerId);
  const importedMarkers = cloneFeedbackMarkers(sourceComments, {
    ...options,
    targetLayerId: targetLayer.id
  });

  targetLayer.markers = [
    ...getMarkers(targetLayer),
    ...importedMarkers
  ];

  return {
    comments,
    importedCount: importedMarkers.length,
    importedMarkers
  };
}
