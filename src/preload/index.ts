import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS as C, type RadarApi } from '../shared/ipc';

const api: RadarApi = {
  settings: {
    getAll: () => ipcRenderer.invoke(C.settingsGetAll),
    get: (key) => ipcRenderer.invoke(C.settingsGet, { key }),
    set: (key, value) => ipcRenderer.invoke(C.settingsSet, { key, value }),
  },
  app: {
    getWindowInfo: () => ipcRenderer.invoke(C.appGetWindowInfo),
    openExternal: (url) => ipcRenderer.invoke(C.appOpenExternal, { url }),
  },
  opportunities: {
    list: () => ipcRenderer.invoke(C.opportunitiesList),
    get: (id) => ipcRenderer.invoke(C.opportunitiesGet, { id }),
    setStarred: (ids, starred) => ipcRenderer.invoke(C.opportunitiesSetStarred, { ids, starred }),
    dismiss: (ids) => ipcRenderer.invoke(C.opportunitiesDismiss, { ids }),
    restore: (ids) => ipcRenderer.invoke(C.opportunitiesRestore, { ids }),
  },
  pipeline: {
    add: (opportunityIds) => ipcRenderer.invoke(C.pipelineAdd, { opportunityIds }),
    remove: (ids) => ipcRenderer.invoke(C.pipelineRemove, { ids }),
  },
  dev: {
    loadSampleData: () => ipcRenderer.invoke(C.devLoadSample),
    clearSampleData: () => ipcRenderer.invoke(C.devClearSample),
  },
};

contextBridge.exposeInMainWorld('radar', api);
