import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type RadarApi } from '../shared/ipc';

const api: RadarApi = {
  settings: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetAll),
    get: (key) => ipcRenderer.invoke(IPC_CHANNELS.settingsGet, { key }),
    set: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.settingsSet, { key, value }),
  },
};

contextBridge.exposeInMainWorld('radar', api);
