import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_CHANNELS as C,
  IPC_EVENTS as E,
  SHELL_CHANNELS as S,
  type RadarApi,
} from '../shared/ipc';

/** Subscribes to a main-process event; the returned function unsubscribes. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: RadarApi = {
  auth: {
    status: () => ipcRenderer.invoke(S.authStatus),
    setup: (password) => ipcRenderer.invoke(S.authSetup, { password }),
    unlock: (password) => ipcRenderer.invoke(S.authUnlock, { password }),
    recover: (recoveryKey, newPassword) =>
      ipcRenderer.invoke(S.authRecover, { recoveryKey, newPassword }),
    confirmRecoveryKey: () => ipcRenderer.invoke(S.authConfirmRecovery),
    lock: () => ipcRenderer.invoke(S.authLock),
    onChanged: (listener) => subscribe(E.authChanged, listener),
    createAccount: (email, password) =>
      ipcRenderer.invoke(S.authCreateAccount, { email, password }),
    signIn: (email, password) => ipcRenderer.invoke(S.authSignIn, { email, password }),
    google: () => ipcRenderer.invoke(S.authGoogle),
    cancel: () => ipcRenderer.invoke(S.authCancel),
    emailConfirmed: () => ipcRenderer.invoke(S.authEmailConfirmed),
    confirmCode: (code) => ipcRenderer.invoke(S.authConfirmCode, { code }),
    resendEmail: () => ipcRenderer.invoke(S.authResendEmail),
    requestReset: (email) => ipcRenderer.invoke(S.authRequestReset, { email }),
    setNewPassword: (password, recoveryKey) =>
      ipcRenderer.invoke(S.authSetNewPassword, { password, recoveryKey }),
    choosePassword: (password) => ipcRenderer.invoke(S.authChoosePassword, { password }),
    finishPasswordChange: (recoveryKey) =>
      ipcRenderer.invoke(S.authFinishPasswordChange, { recoveryKey }),
    signOut: () => ipcRenderer.invoke(S.authSignOut),
    join: (recoveryKey) => ipcRenderer.invoke(S.authJoin, { recoveryKey }),
    skipJoin: () => ipcRenderer.invoke(S.authSkipJoin),
  },
  settings: {
    getAll: () => ipcRenderer.invoke(C.settingsGetAll),
    get: (key) => ipcRenderer.invoke(C.settingsGet, { key }),
    set: (key, value) => ipcRenderer.invoke(C.settingsSet, { key, value }),
  },
  app: {
    getWindowInfo: () => ipcRenderer.invoke(S.appGetWindowInfo),
    openExternal: (url) => ipcRenderer.invoke(C.appOpenExternal, { url }),
    navCounts: (newSince) => ipcRenderer.invoke(C.appNavCounts, { newSince }),
    setChromeTheme: (theme) => ipcRenderer.invoke(S.appChromeTheme, { theme }),
    windowControl: (action) => ipcRenderer.invoke(S.windowControl, { action }),
    windowState: () => ipcRenderer.invoke(S.windowState),
    onWindowState: (listener) => subscribe(E.windowState, listener),
    onMatchAlert: (listener) => subscribe(E.matchAlert, listener),
    copyText: (text) => ipcRenderer.invoke(C.appCopyText, { text }),
    openMail: (to, subject, body) => ipcRenderer.invoke(C.appOpenMail, { to, subject, body }),
  },
  opportunities: {
    list: () => ipcRenderer.invoke(C.opportunitiesList),
    get: (id) => ipcRenderer.invoke(C.opportunitiesGet, { id }),
    search: (query) => ipcRenderer.invoke(C.opportunitiesSearch, { query }),
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
  outreach: {
    list: () => ipcRenderer.invoke(C.outreachList),
    saveDraft: (pipelineId, draft) =>
      ipcRenderer.invoke(C.outreachSaveDraft, { pipelineId, draft }),
    templates: () => ipcRenderer.invoke(C.outreachTemplates),
    saveTemplate: (id, template) => ipcRenderer.invoke(C.outreachSaveTemplate, { id, template }),
    deleteTemplate: (id) => ipcRenderer.invoke(C.outreachDeleteTemplate, { id }),
  },
  rules: {
    get: () => ipcRenderer.invoke(C.rulesGet),
    save: (rules) => ipcRenderer.invoke(C.rulesSave, { rules }),
    reset: () => ipcRenderer.invoke(C.rulesReset),
    rescore: () => ipcRenderer.invoke(C.rulesRescore),
    preview: () => ipcRenderer.invoke(C.rulesPreview),
  },
  data: {
    backupInfo: () => ipcRenderer.invoke(C.dataBackupInfo),
    backupNow: () => ipcRenderer.invoke(C.dataBackupNow),
    chooseBackupFolder: () => ipcRenderer.invoke(C.dataChooseBackupFolder),
    openBackupFolder: () => ipcRenderer.invoke(C.dataOpenBackupFolder),
    exportJson: () => ipcRenderer.invoke(C.dataExportJson),
    exportCsv: () => ipcRenderer.invoke(C.dataExportCsv),
  },
  scan: {
    run: (sources) => ipcRenderer.invoke(C.scanRun, sources ? { sources } : undefined),
    status: () => ipcRenderer.invoke(C.scanStatus),
    onProgress: (listener) => subscribe(E.scanProgress, listener),
    onFinished: (listener) => subscribe(E.scanFinished, listener),
  },
  sync: {
    status: () => ipcRenderer.invoke(C.syncStatus),
    now: () => ipcRenderer.invoke(C.syncNow),
    useRecoveryKey: (recoveryKey) => ipcRenderer.invoke(C.syncUseRecoveryKey, { recoveryKey }),
    onChanged: (listener) => subscribe(E.syncChanged, listener),
    onApplied: (listener) => subscribe(E.syncApplied, listener),
  },
  dev: {
    loadSampleData: () => ipcRenderer.invoke(C.devLoadSample),
    clearSampleData: () => ipcRenderer.invoke(C.devClearSample),
  },
};

contextBridge.exposeInMainWorld('radar', api);
