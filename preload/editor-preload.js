const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editorAPI', Object.freeze({
  pickMedia: (kind) => ipcRenderer.invoke('editor:pick-media', kind),
  openProject: () => ipcRenderer.invoke('editor:open-project'),
  saveProject: (project, saveAs = false) => ipcRenderer.invoke('editor:save-project', project, saveAs),
  exportVideo: (payload) => ipcRenderer.invoke('editor:export-video', payload),
  cancelExport: () => ipcRenderer.invoke('editor:cancel-export'),
  onExportProgress(callback) {
    if (typeof callback !== 'function') throw new TypeError('진행률 콜백이 필요합니다.');
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('editor:export-progress', listener);
    return () => ipcRenderer.removeListener('editor:export-progress', listener);
  },
  setDirty: (value) => ipcRenderer.send('editor:set-dirty', value === true),
  confirmDiscard: () => ipcRenderer.invoke('editor:confirm-discard')
}));
