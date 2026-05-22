/**
 * BAEFRAME 컷 묶음 매니저
 *
 * .bcutlist 상태, 파일 I/O, Moho info txt + 출력 영상 연결을 담당한다.
 */

import { createLogger } from '../logger.js';
import {
  createCutlistCut,
  createCutlistSource,
  createDefaultCutlistData,
  extractFileName,
  sanitizeFileName,
  suggestCutlistFileName,
  validateCutlistData
} from '../../../shared/cutlist-schema.js';
import { buildCutsFromMohoSceneInfo } from './moho-scene-info-parser.js';
import {
  applyManualCutOrder,
  buildCutlistTimeline,
  buildMissingSceneRows,
  sortCutsBySceneNumber
} from './cutlist-core.js';

const log = createLogger('CutlistManager');
const DEFAULT_CUTLIST_NAME = '새 컷 묶음';

function getElectronAPI() {
  return globalThis.window?.electronAPI || null;
}

function getAppUser() {
  const appState = globalThis.window?.appState || {};
  return {
    userName: appState.userName || '',
    userId: appState.sessionId || ''
  };
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function cloneCutlistData(data) {
  return JSON.parse(JSON.stringify(data));
}

function getSaveBaseName(cutlist) {
  const suggestedName = suggestCutlistFileName(cutlist?.cuts || []).replace(/\.bcutlist$/i, '');
  const cutlistName = String(cutlist?.name || '').trim();
  return cutlistName && cutlistName !== DEFAULT_CUTLIST_NAME
    ? cutlistName
    : suggestedName;
}

function normalizeCut(cut, order) {
  return {
    ...createCutlistCut({
      ...cut,
      order: Number.isFinite(Number(cut?.order)) ? Number(cut.order) : order
    }),
    frameCount: Number.isFinite(Number(cut?.frameCount))
      ? Number(cut.frameCount)
      : Math.max(0, Number(cut?.endFrame) - Number(cut?.startFrame) + 1)
  };
}

function normalizeIgnoredLabel(item) {
  return {
    label: item?.label || '',
    sceneNumber: Number.isFinite(Number(item?.sceneNumber)) ? Number(item.sceneNumber) : null,
    mohoStartFrame: Number.isFinite(Number(item?.mohoStartFrame)) ? Number(item.mohoStartFrame) : null,
    mohoEndFrame: Number.isFinite(Number(item?.mohoEndFrame)) ? Number(item.mohoEndFrame) : null,
    reason: item?.reason || 'ignored'
  };
}

function sortAndReindexCuts(cuts = []) {
  return sortCutsBySceneNumber(cuts).map((cut, order) => ({
    ...cut,
    order
  }));
}

export class CutlistManager {
  constructor(options = {}) {
    this.api = options.electronAPI || getElectronAPI();
    this.currentCutlist = null;
    this.cutlistPath = null;
    this.currentCutId = null;
    this.isModified = false;
    this.lastIgnored = [];

    this.onCutlistLoaded = null;
    this.onCutSelected = null;
    this.onCutlistModified = null;
    this.onCutlistClosed = null;
    this.onError = null;

    log.info('CutlistManager 초기화');
  }

  createNew(name = DEFAULT_CUTLIST_NAME) {
    const user = getAppUser();
    this.currentCutlist = createDefaultCutlistData({
      name,
      userName: user.userName,
      userId: user.userId
    });
    this.cutlistPath = null;
    this.currentCutId = null;
    this.lastIgnored = [];
    this.isModified = true;

    this.onCutlistLoaded?.(this.currentCutlist);
    this._emitChanged('createNew');
    return this.currentCutlist;
  }

  async open(filePath) {
    const api = this._requireAPI();
    log.info('컷 묶음 열기', { filePath });

    try {
      const data = await api.readCutlist(filePath);
      if (!data) {
        throw new Error('컷 묶음 파일을 찾을 수 없습니다.');
      }

      const validation = validateCutlistData(data);
      if (!validation.valid) {
        throw new Error(`유효하지 않은 컷 묶음 파일입니다: ${validation.errors.join(', ')}`);
      }

      this.currentCutlist = cloneCutlistData(data);
      this.currentCutlist.settings = {
        showMissingScenes: this.currentCutlist.settings?.showMissingScenes === true,
        manualOrder: this.currentCutlist.settings?.manualOrder === true
      };
      this.currentCutlist.sources = this.currentCutlist.sources.map(source => ({
        ...source,
        ignoredLabels: Array.isArray(source.ignoredLabels) ? source.ignoredLabels : []
      }));
      this.currentCutlist.cuts = this.currentCutlist.cuts.map(normalizeCut);
      this.cutlistPath = filePath;
      this.currentCutId = null;
      this.lastIgnored = [];

      await this.refreshMissingSources({ emit: false });
      this._reconcileCurrentCutSelection();
      this.isModified = false;

      this.onCutlistLoaded?.(this.currentCutlist);
      return this.currentCutlist;
    } catch (error) {
      log.error('컷 묶음 열기 실패', { filePath, error: error.message });
      this.onError?.(error);
      throw error;
    }
  }

  async save(savePath = null) {
    if (!this.currentCutlist) {
      throw new Error('저장할 컷 묶음이 없습니다.');
    }

    const api = this._requireAPI();
    let targetPath = savePath || this.cutlistPath;

    if (!targetPath) {
      if (!this.currentCutlist.sources.length) {
        throw new Error('저장할 소스가 없습니다. 먼저 info txt와 출력 영상을 추가해주세요.');
      }

      const firstSource = this.currentCutlist.sources[0];
      const folderPath = await api.pathDirname(firstSource.infoPath || firstSource.videoPath);
      const safeName = sanitizeFileName(getSaveBaseName(this.currentCutlist));
      targetPath = await api.pathJoin(folderPath, `${safeName}.bcutlist`);
    }

    this.currentCutlist.modifiedAt = new Date().toISOString();
    await api.writeCutlist(targetPath, this.currentCutlist);
    this.cutlistPath = targetPath;
    this.isModified = false;
    return targetPath;
  }

  async addSourcePair(infoPath, videoPath) {
    if (!infoPath || !videoPath) {
      throw new Error('info txt와 출력 영상 경로가 필요합니다.');
    }
    if (!this.currentCutlist) {
      this.createNew();
    }

    const api = this._requireAPI();
    const infoText = await api.readCutlistInfoText(infoPath);
    const parsed = buildCutsFromMohoSceneInfo(infoText, {
      sourceId: this._createSourceId()
    });
    const sourceId = parsed.cuts[0]?.sourceId || this._createSourceId();
    const videoInfo = await this._getFileInfo(videoPath);
    const exists = await this._fileExists(videoPath);
    const ignoredLabels = (parsed.ignored || []).map(normalizeIgnoredLabel);
    const source = {
      ...createCutlistSource({
        id: sourceId,
        videoPath,
        infoPath,
        infoText,
        fileName: videoInfo?.name || extractFileName(videoPath),
        fps: parsed.fps,
        missing: exists === false
      }),
      projectPath: parsed.projectPath || '',
      ignoredLabels
    };
    const cuts = parsed.cuts.map((cut, order) => normalizeCut({
      ...cut,
      sourceId,
      order
    }, order));
    const knownSourceIndex = this.currentCutlist.sources.findIndex(item => (
      normalizePath(item.videoPath) === normalizePath(videoPath)
      && normalizePath(item.infoPath) === normalizePath(infoPath)
    ));

    if (knownSourceIndex >= 0) {
      const oldSourceId = this.currentCutlist.sources[knownSourceIndex].id;
      this.currentCutlist.sources[knownSourceIndex] = source;
      this.currentCutlist.cuts = this.currentCutlist.cuts.filter(cut => cut.sourceId !== oldSourceId);
    } else {
      this.currentCutlist.sources.push(source);
    }

    this.currentCutlist.cuts.push(...cuts);
    this.currentCutlist.cuts = sortAndReindexCuts(this.currentCutlist.cuts);
    const selection = this._reconcileCurrentCutSelection(cuts[0]?.id || null);
    this.lastIgnored = ignoredLabels;
    this.currentCutlist.modifiedAt = new Date().toISOString();
    this.isModified = true;
    this._emitChanged('addSourcePair');
    if (selection.changed) {
      this._emitSelectionChanged(selection.cut);
    }

    return { source, cuts, ignored: ignoredLabels };
  }

  setName(name) {
    if (!this.currentCutlist) return;
    const nextName = String(name || '').trim() || DEFAULT_CUTLIST_NAME;
    if (this.currentCutlist.name === nextName) return;
    this.currentCutlist.name = nextName;
    this.currentCutlist.modifiedAt = new Date().toISOString();
    this.isModified = true;
    this._emitChanged('setName');
  }

  setShowMissingScenes(enabled) {
    if (!this.currentCutlist) return;
    this.currentCutlist.settings = this.currentCutlist.settings || {};
    const nextValue = enabled === true;
    if (this.currentCutlist.settings.showMissingScenes === nextValue) return;
    this.currentCutlist.settings.showMissingScenes = nextValue;
    this.currentCutlist.modifiedAt = new Date().toISOString();
    this.isModified = true;
    this._emitChanged('setShowMissingScenes');
  }

  selectCut(cutId) {
    const cut = this.getCutById(cutId);
    if (!cut) return null;

    this.currentCutId = cut.id;
    this._emitSelectionChanged(cut);
    return cut;
  }

  getOrderedCuts() {
    if (!this.currentCutlist) return [];
    const cuts = this.currentCutlist.cuts || [];
    const settings = this.currentCutlist.settings || {};
    if (settings.manualOrder) {
      const manualOrder = cuts
        .slice()
        .sort((a, b) => Number(a.order) - Number(b.order))
        .map(cut => cut.id);
      return applyManualCutOrder(cuts, manualOrder);
    }
    return sortCutsBySceneNumber(cuts);
  }

  getRows() {
    const showMissingScenes = this.currentCutlist?.settings?.showMissingScenes === true;
    return buildMissingSceneRows(this.getOrderedCuts(), { showMissingScenes });
  }

  getTimeline() {
    return buildCutlistTimeline(this.getOrderedCuts());
  }

  getCutById(cutId) {
    return (this.currentCutlist?.cuts || []).find(cut => cut.id === cutId) || null;
  }

  getSourceById(sourceId) {
    return (this.currentCutlist?.sources || []).find(source => source.id === sourceId) || null;
  }

  async reconnectSource(sourceId, videoPath) {
    const source = this.getSourceById(sourceId);
    if (!source || !videoPath) return false;

    const videoInfo = await this._getFileInfo(videoPath);
    source.videoPath = videoPath;
    source.fileName = videoInfo?.name || extractFileName(videoPath);
    source.missing = !(await this._fileExists(videoPath));
    this.currentCutlist.modifiedAt = new Date().toISOString();
    this.isModified = true;
    this._emitChanged('reconnectSource');
    return true;
  }

  async refreshMissingSources(options = {}) {
    if (!this.currentCutlist) return [];

    const changed = [];
    for (const source of this.currentCutlist.sources || []) {
      const exists = await this._fileExists(source.videoPath);
      const nextMissing = exists === false;
      if (source.missing !== nextMissing) {
        source.missing = nextMissing;
        changed.push(source);
      }
    }

    if (changed.length > 0 && options.emit !== false) {
      this.currentCutlist.modifiedAt = new Date().toISOString();
      this.isModified = true;
      this._emitChanged('refreshMissingSources');
    }

    return changed;
  }

  close() {
    this.currentCutlist = null;
    this.cutlistPath = null;
    this.currentCutId = null;
    this.isModified = false;
    this.lastIgnored = [];
    this.onCutlistClosed?.();
    this._dispatch('cutlist:closed', {});
  }

  isActive() {
    return !!this.currentCutlist;
  }

  _emitChanged(reason) {
    this.onCutlistModified?.(this.currentCutlist, reason);
    this._dispatch('cutlist:changed', {
      cutlist: this.currentCutlist,
      reason
    });
  }

  _reconcileCurrentCutSelection(preferredCutId = null) {
    const previousCutId = this.currentCutId;
    const orderedCuts = this.getOrderedCuts();
    const preferredCut = preferredCutId
      ? orderedCuts.find(cut => cut.id === preferredCutId) || null
      : null;
    const currentCut = this.getCutById(this.currentCutId);
    const nextCut = preferredCut || currentCut || orderedCuts[0] || null;

    this.currentCutId = nextCut?.id || null;
    return {
      cut: nextCut,
      changed: previousCutId !== this.currentCutId
    };
  }

  _emitSelectionChanged(cut) {
    const index = cut
      ? this.getOrderedCuts().findIndex(item => item.id === cut.id)
      : -1;
    this.onCutSelected?.(cut, index);
    this._dispatch('cutlist:selection-changed', { cut });
  }

  _dispatch(type, detail) {
    const target = globalThis.window;
    if (!target?.dispatchEvent || typeof globalThis.CustomEvent !== 'function') return;
    target.dispatchEvent(new globalThis.CustomEvent(type, { detail }));
  }

  _requireAPI() {
    const api = this.api || getElectronAPI();
    if (!api) {
      throw new Error('Electron API를 사용할 수 없습니다.');
    }
    this.api = api;
    return api;
  }

  _createSourceId() {
    const nextNumber = (this.currentCutlist?.sources?.length || 0) + 1;
    return `source_${Date.now()}_${nextNumber}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async _getFileInfo(filePath) {
    try {
      return await this._requireAPI().getFileInfo?.(filePath);
    } catch (error) {
      log.warn('파일 정보 확인 실패', { filePath, error: error.message });
      return null;
    }
  }

  async _fileExists(filePath) {
    try {
      if (!this._requireAPI().fileExists) return true;
      return await this._requireAPI().fileExists(filePath);
    } catch {
      return false;
    }
  }
}

let instance = null;

export function getCutlistManager() {
  if (!instance) {
    instance = new CutlistManager();
  }
  return instance;
}

export default CutlistManager;
