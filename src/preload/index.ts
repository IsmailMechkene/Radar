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
    navCounts: (newSince) => ipcRenderer.invoke(C.appNavCounts, { newSince }),
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
    list: () => ipcRenderer.invoke(C.pipelineList),
    create: (row) => ipcRenderer.invoke(C.pipelineCreate, { row }),
    update: (id, patch) => ipcRenderer.invoke(C.pipelineUpdate, { id, patch }),
    importCsv: () => ipcRenderer.invoke(C.pipelineImportCsv),
  },
  deadlines: {
    list: () => ipcRenderer.invoke(C.deadlinesList),
    add: (deadline) => ipcRenderer.invoke(C.deadlinesAdd, { deadline }),
    remove: (id) => ipcRenderer.invoke(C.deadlinesRemove, { id }),
    snooze: (target, until) => ipcRenderer.invoke(C.deadlinesSnooze, { target, until }),
    done: (target) => ipcRenderer.invoke(C.deadlinesDone, { target }),
    undoDone: (ids) => ipcRenderer.invoke(C.deadlinesUndoDone, { ids }),
    exportIcs: () => ipcRenderer.invoke(C.deadlinesExportIcs),
  },
  programs: {
    list: () => ipcRenderer.invoke(C.programsList),
    create: (program) => ipcRenderer.invoke(C.programsCreate, { program }),
    update: (id, patch) => ipcRenderer.invoke(C.programsUpdate, { id, patch }),
    remove: (id) => ipcRenderer.invoke(C.programsDelete, { id }),
    check: (id) => ipcRenderer.invoke(C.programsCheck, { id }),
    markReviewed: (alertId) => ipcRenderer.invoke(C.programsMarkReviewed, { alertId }),
  },
  sources: {
    list: () => ipcRenderer.invoke(C.sourcesList),
    setPaused: (id, paused) => ipcRenderer.invoke(C.sourcesSetPaused, { id, paused }),
    add: (source) => ipcRenderer.invoke(C.sourcesAdd, { source }),
    remove: (id) => ipcRenderer.invoke(C.sourcesDelete, { id }),
    test: (target) => ipcRenderer.invoke(C.sourcesTest, target),
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
