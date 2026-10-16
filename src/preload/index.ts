import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS as C, IPC_EVENTS as E, type RadarApi } from '../shared/ipc';

/** Subscribes to a main-process event; the returned function unsubscribes. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

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
  scan: {
    run: (sources) => ipcRenderer.invoke(C.scanRun, sources ? { sources } : undefined),
    status: () => ipcRenderer.invoke(C.scanStatus),
    onProgress: (listener) => subscribe(E.scanProgress, listener),
    onFinished: (listener) => subscribe(E.scanFinished, listener),
  },
  dev: {
    loadSampleData: () => ipcRenderer.invoke(C.devLoadSample),
    clearSampleData: () => ipcRenderer.invoke(C.devClearSample),
  },
};

contextBridge.exposeInMainWorld('radar', api);
