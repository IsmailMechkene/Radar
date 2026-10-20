import type Database from 'better-sqlite3-multiple-ciphers';
import type { IpcMain, WebContents } from 'electron';
import { mkdirSync } from 'node:fs';
import { z } from 'zod';
import {
  dismissOpportunities,
  getOpportunityDetail,
  listOpportunityItems,
  searchOpportunityIds,
  restoreOpportunities,
  setStarred,
} from '../core/db/opportunities';
import {
  addOpportunitiesToPipeline,
  createPipelineRow,
  listPipeline,
  removePipelineRows,
  updatePipelineRow,
} from '../core/db/pipeline';
import { importPipelineCsv } from '../core/pipeline/import';
import { toIcs } from '../core/deadlines/ics';
import {
  addManualDeadline,
  listDeadlines,
  markTargetDone,
  removeManualDeadline,
  snoozeTarget,
  undoDone,
} from '../core/deadlines/list';
import { markReminderDone, snoozeReminder } from '../core/reminders/store';
import {
  createProgram,
  deleteProgram,
  listPrograms,
  markAlertReviewed,
  updateProgram,
} from '../core/programs/manage';
import type { PageCheck } from '../core/watch/pages';
import { navCounts } from '../core/nav';
import { backupDatabase, backupFileName, listBackups } from '../core/backup';
import { exportCsv, exportJson } from '../core/export';
import { join } from 'node:path';
import {
  deleteTemplate,
  listOutreach,
  listTemplates,
  mailtoUrl,
  saveDraft,
  saveTemplate,
} from '../core/outreach';
import {
  addSource,
  adapterSourceFor,
  adapterSourceOf,
  deleteSource,
  listSourceItems,
  setSourcePaused,
  type TestResult,
} from '../core/sources/manage';
import type { AdapterSource } from '../core/adapters/types';
import type { RescoreResult } from '../core/rules/rescore';
import type { Rules } from '../core/rules/schema';
import { effectiveRules, previewItems, resetUserRules, saveUserRules } from '../core/rules/store';
import { clearSampleData, loadSampleData } from '../core/dev/sample';
import { settingsSchema, type Settings } from '../core/settings/schema';
import { getAllSettings, getSetting, setSetting } from '../core/settings/store';
import {
  appGetWindowInfoPayloadSchema,
  appOpenExternalPayloadSchema,
  appNavCountsPayloadSchema,
  appChromeThemePayloadSchema,
  windowControlPayloadSchema,
  windowStatePayloadSchema,
  authCredentialsPayloadSchema,
  authEmailPayloadSchema,
  authCodePayloadSchema,
  authNewPasswordPayloadSchema,
  authNoPayloadSchema,
  authPasswordPayloadSchema,
  authRecoverPayloadSchema,
  authRecoveryKeyPayloadSchema,
  syncNoPayloadSchema,
  syncRecoveryKeyPayloadSchema,
  SHELL_CHANNELS as S,
  dataNoPayloadSchema,
  appCopyTextPayloadSchema,
  appOpenMailPayloadSchema,
  outreachListPayloadSchema,
  outreachSaveDraftPayloadSchema,
  outreachTemplatesPayloadSchema,
  outreachSaveTemplatePayloadSchema,
  outreachDeleteTemplatePayloadSchema,
  devPayloadSchema,
  IPC_CHANNELS as C,
  opportunitiesGetPayloadSchema,
  opportunitiesSearchPayloadSchema,
  opportunitiesIdsPayloadSchema,
  opportunitiesListPayloadSchema,
  opportunitiesSetStarredPayloadSchema,
  pipelineAddPayloadSchema,
  pipelineRemovePayloadSchema,
  pipelineListPayloadSchema,
  pipelineCreatePayloadSchema,
  pipelineUpdatePayloadSchema,
  pipelineImportCsvPayloadSchema,
  deadlinesListPayloadSchema,
  deadlinesAddPayloadSchema,
  deadlinesRemovePayloadSchema,
  deadlinesSnoozePayloadSchema,
  deadlinesDonePayloadSchema,
  deadlinesUndoDonePayloadSchema,
  deadlinesExportIcsPayloadSchema,
  programsListPayloadSchema,
  programsCreatePayloadSchema,
  programsUpdatePayloadSchema,
  programIdPayloadSchema,
  programsMarkReviewedPayloadSchema,
  sourcesListPayloadSchema,
  sourcesSetPausedPayloadSchema,
  sourcesAddPayloadSchema,
  sourceIdPayloadSchema,
  sourcesTestPayloadSchema,
  rulesGetPayloadSchema,
  rulesSavePayloadSchema,
  rulesNoPayloadSchema,
  scanRunPayloadSchema,
  scanStatusPayloadSchema,
  copilotNoPayloadSchema,
  copilotReviewPayloadSchema,
  copilotIdPayloadSchema,
  settingsGetAllPayloadSchema,
  settingsGetPayloadSchema,
  settingsSetPayloadSchema,
  type AuthStatus,
  type CopilotCheck,
  type IpcChannel,
  type SyncStatus,
  type WindowInfo,
} from '../shared/ipc';
import type { ResolvedTheme, ThemePreference, WindowAction, WindowState } from '../shared/theme';
import type { ScanService } from './scan';
import type { SyncService } from './sync';
import type { CopilotService } from './copilot/service';
import { listCopilotItems, reviewInput } from '../core/copilot/reviews';
import { getTailoredCv } from '../core/copilot/cvs';
import { cvFileName, cvHtml } from './copilot/cv';

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>;

export interface IpcDeps {
  ipcMain: IpcMainLike;
  db: Database.Database;
  applyAutostart: (enabled: boolean) => void;
  applyTheme: (theme: ThemePreference) => void;
  windowInfo: () => WindowInfo;
  openExternal: (url: string) => Promise<void>;
  /** System clipboard (main process). */
  copyText?: (text: string) => void;
  /** Opens a mailto: link in the default mail app. */
  openMailto?: (url: string) => Promise<void>;
  /** Reads the dev sample fixture (raw JSON, validated by the loader). */
  readSampleFixture: () => unknown;
  scan: Pick<ScanService, 'run' | 'status'>;
  /** Called after a setting is stored (e.g. to re-score when a scoring setting changed). */
  onSettingChanged?: (key: string) => void;
  /** Native "open file" dialog for a CSV; resolves to the path, or null when cancelled. */
  pickCsvFile?: () => Promise<string | null>;
  readTextFile?: (path: string) => string;
  /** Called after something reminders depend on changed (pipeline, deadlines, programs). */
  onRemindersChanged?: () => void;
  /** Fetches a program's watched page now (shared fetch layer). */
  checkProgramPage?: (programId: number) => Promise<PageCheck>;
  /** Test fetch through the shared fetch layer; stores nothing. */
  testSource?: (source: AdapterSource) => Promise<TestResult>;
  /** seeds/rules.json as loaded at startup (null when it could not be read). */
  defaultRules?: () => Rules | null;
  /** Reloads the rules in use and re-scores; returns the counts. */
  rulesChanged?: () => Promise<RescoreResult | null>;
  rescoreNow?: () => Promise<RescoreResult | null>;
  /** Native "save file" dialog; writes the text and resolves to the path, or null when cancelled. */
  saveTextFile?: (
    suggestedName: string,
    contents: string,
    filter: { name: string; extensions: string[] },
  ) => Promise<string | null>;
  /** Backups folder when none is chosen. */
  defaultBackupFolder?: () => string;
  /** Native folder picker; null when cancelled. */
  chooseFolder?: (title: string, defaultPath?: string) => Promise<string | null>;
  /** Shows a folder in the file manager. */
  openFolder?: (path: string) => Promise<void>;
  /** Radar Copilot: finds Claude Code and makes one tiny request with these settings. */
  checkCopilot?: (settings: Settings['copilot']) => Promise<CopilotCheck>;
  /** Radar Copilot's queue (reviews and tailored CVs). */
  copilot?: Pick<CopilotService, 'status' | 'review' | 'reviewWaiting' | 'stop' | 'makeCv'>;
  /** Prints self-contained HTML to PDF and saves it (native save dialog); null when cancelled. */
  savePdf?: (html: string, suggestedName: string) => Promise<string | null>;
  /** End-to-end encrypted sync; absent when accounts are off. */
  sync?: Pick<SyncService, 'status' | 'now' | 'useRecoveryKey'> | null;
  now?: () => Date;
  /**
   * Accepts only messages from Radar's own page (the URL of the sending frame). Without it,
   * every sender is accepted (tests).
   */
  isTrustedSender?: (senderUrl: string | undefined) => boolean;
}

/** Set by registerIpcHandlers; checked by every handler. */
let trustedSender: IpcDeps['isTrustedSender'] | undefined;

function describe(err: unknown): string {
  if (err instanceof z.ZodError) return z.prettifyError(err);
  return err instanceof Error ? err.message : String(err);
}

function handle<S extends z.ZodType>(
  ipcMain: Pick<IpcMain, 'handle'>,
  channel: IpcChannel,
  schema: S,
  fn: (payload: z.output<S>, sender: WebContents) => unknown,
): void {
  ipcMain.handle(channel, async (event, payload: unknown) => {
    const sender = (event as { senderFrame?: { url?: string } | null }).senderFrame?.url;
    if (trustedSender && !trustedSender(sender)) {
      console.error(`[ipc] ${channel}: refused a message from ${sender ?? 'an unknown frame'}`);
      throw new Error(`${channel}: not allowed from this page`);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const message = `${channel}: invalid payload\n${z.prettifyError(parsed.error)}`;
      console.error(`[ipc] ${message}`);
      throw new Error(message);
    }
    try {
      return await fn(parsed.data, (event as { sender: WebContents }).sender);
    } catch (err) {
      const message = `${channel} failed: ${describe(err)}`;
      console.error(`[ipc] ${message}`);
      throw new Error(message, { cause: err });
    }
  });
}

/** Records every channel it registers, so they can all be removed again. */
function tracked(ipcMain: IpcMainLike): { ipc: Pick<IpcMain, 'handle'>; remove: () => void } {
  const channels: string[] = [];
  return {
    ipc: {
      handle: (channel, fn) => {
        channels.push(channel);
        ipcMain.handle(channel, fn);
      },
    },
    remove: () => {
      for (const channel of channels.splice(0)) ipcMain.removeHandler(channel);
    },
  };
}

export interface ShellIpcDeps {
  ipcMain: IpcMainLike;
  windowInfo: () => WindowInfo;
  /** Native window background in the theme the page now shows. */
  setChromeTheme?: (theme: ResolvedTheme) => void;
  /** The window buttons drawn by the page act on the window that sent them. */
  windowControl?: (sender: WebContents, action: WindowAction) => void;
  windowState?: (sender: WebContents) => WindowState;
  auth: {
    status: () => AuthStatus;
    setup: (password: string) => Promise<AuthStatus>;
    unlock: (password: string) => Promise<AuthStatus>;
    recover: (recoveryKey: string, newPassword: string) => Promise<AuthStatus>;
    confirmRecoveryKey: () => Promise<AuthStatus>;
    lock: () => Promise<AuthStatus>;
    createAccount: (email: string, password: string) => Promise<AuthStatus>;
    signIn: (email: string, password: string) => Promise<AuthStatus>;
    google: () => Promise<AuthStatus>;
    cancel: () => Promise<AuthStatus>;
    emailConfirmed: () => Promise<AuthStatus>;
    resendEmail: () => Promise<AuthStatus>;
    confirmCode: (code: string) => Promise<AuthStatus>;
    requestReset: (email: string) => Promise<AuthStatus>;
    setNewPassword: (password: string, recoveryKey: string) => Promise<AuthStatus>;
    choosePassword: (password: string) => Promise<AuthStatus>;
    finishPasswordChange: (recoveryKey: string) => Promise<AuthStatus>;
    signOut: () => Promise<AuthStatus>;
    join: (recoveryKey: string) => Promise<AuthStatus>;
    skipJoin: () => Promise<AuthStatus>;
  };
  isTrustedSender?: (senderUrl: string | undefined) => boolean;
}

/** Channels that work while locked (window chrome, the lock itself). Registered once. */
export function registerShellHandlers(deps: ShellIpcDeps): void {
  trustedSender = deps.isTrustedSender;
  const { ipcMain, auth } = deps;
  handle(ipcMain, S.appGetWindowInfo, appGetWindowInfoPayloadSchema, () => deps.windowInfo());
  handle(ipcMain, S.appChromeTheme, appChromeThemePayloadSchema, ({ theme }) =>
    deps.setChromeTheme?.(theme),
  );
  handle(ipcMain, S.windowControl, windowControlPayloadSchema, ({ action }, sender) =>
    deps.windowControl?.(sender, action),
  );
  handle(
    ipcMain,
    S.windowState,
    windowStatePayloadSchema,
    (_p, sender): WindowState => deps.windowState?.(sender) ?? { maximized: false, focused: true },
  );
  handle(ipcMain, S.authStatus, authNoPayloadSchema, () => auth.status());
  handle(ipcMain, S.authSetup, authPasswordPayloadSchema, ({ password }) => auth.setup(password));
  handle(ipcMain, S.authUnlock, authPasswordPayloadSchema, ({ password }) => auth.unlock(password));
  handle(ipcMain, S.authRecover, authRecoverPayloadSchema, ({ recoveryKey, newPassword }) =>
    auth.recover(recoveryKey, newPassword),
  );
  handle(ipcMain, S.authConfirmRecovery, authNoPayloadSchema, () => auth.confirmRecoveryKey());
  handle(ipcMain, S.authLock, authNoPayloadSchema, () => auth.lock());
  handle(ipcMain, S.authCreateAccount, authCredentialsPayloadSchema, ({ email, password }) =>
    auth.createAccount(email, password),
  );
  handle(ipcMain, S.authSignIn, authCredentialsPayloadSchema, ({ email, password }) =>
    auth.signIn(email, password),
  );
  handle(ipcMain, S.authGoogle, authNoPayloadSchema, () => auth.google());
  handle(ipcMain, S.authCancel, authNoPayloadSchema, () => auth.cancel());
  handle(ipcMain, S.authEmailConfirmed, authNoPayloadSchema, () => auth.emailConfirmed());
  handle(ipcMain, S.authResendEmail, authNoPayloadSchema, () => auth.resendEmail());
  handle(ipcMain, S.authConfirmCode, authCodePayloadSchema, ({ code }) => auth.confirmCode(code));
  handle(ipcMain, S.authRequestReset, authEmailPayloadSchema, ({ email }) =>
    auth.requestReset(email),
  );
  handle(ipcMain, S.authSetNewPassword, authNewPasswordPayloadSchema, (p) =>
    auth.setNewPassword(p.password, p.recoveryKey),
  );
  handle(ipcMain, S.authChoosePassword, authPasswordPayloadSchema, ({ password }) =>
    auth.choosePassword(password),
  );
  handle(ipcMain, S.authFinishPasswordChange, authRecoveryKeyPayloadSchema, ({ recoveryKey }) =>
    auth.finishPasswordChange(recoveryKey),
  );
  handle(ipcMain, S.authSignOut, authNoPayloadSchema, () => auth.signOut());
  handle(ipcMain, S.authJoin, authRecoveryKeyPayloadSchema, ({ recoveryKey }) =>
    auth.join(recoveryKey),
  );
  handle(ipcMain, S.authSkipJoin, authNoPayloadSchema, () => auth.skipJoin());
}

/**
 * Data channels, registered on unlock. Returns the function that removes them all again (lock),
 * after which the page gets "no handler" errors instead of data.
 */
export function registerIpcHandlers(deps: IpcDeps): () => void {
  if (deps.isTrustedSender) trustedSender = deps.isTrustedSender;
  const { db, applyAutostart, applyTheme } = deps;
  const { ipc: ipcMain, remove } = tracked(deps.ipcMain);
  const windowInfo = deps.windowInfo;
  const now = deps.now ?? (() => new Date());

  handle(ipcMain, C.settingsGetAll, settingsGetAllPayloadSchema, () => getAllSettings(db));

  handle(ipcMain, C.settingsGet, settingsGetPayloadSchema, ({ key }) => getSetting(db, key));

  handle(ipcMain, C.settingsSet, settingsSetPayloadSchema, ({ key, value }) => {
    if (key === 'autostart') {
      // Apply to the OS first so the stored value never claims something that failed.
      applyAutostart(settingsSchema.shape.autostart.parse(value));
    }
    const stored = setSetting(db, key, value);
    if (key === 'theme') applyTheme(settingsSchema.shape.theme.parse(stored));
    deps.onSettingChanged?.(key);
    return stored;
  });

  handle(ipcMain, C.appOpenExternal, appOpenExternalPayloadSchema, ({ url }) =>
    deps.openExternal(url),
  );

  handle(ipcMain, C.appNavCounts, appNavCountsPayloadSchema, ({ newSince }) =>
    navCounts(db, { now: now(), timeZone: getSetting(db, 'timezone'), newSince }),
  );

  handle(ipcMain, C.appCopyText, appCopyTextPayloadSchema, ({ text }) => {
    if (!deps.copyText) throw new Error('Copy is not available');
    deps.copyText(text);
  });

  handle(ipcMain, C.appOpenMail, appOpenMailPayloadSchema, ({ to, subject, body }) => {
    if (!deps.openMailto) throw new Error('Opening the mail app is not available');
    return deps.openMailto(mailtoUrl(to, subject, body));
  });

  handle(ipcMain, C.outreachList, outreachListPayloadSchema, () =>
    listOutreach(db, getSetting(db, 'timezone')),
  );

  handle(ipcMain, C.outreachSaveDraft, outreachSaveDraftPayloadSchema, ({ pipelineId, draft }) =>
    saveDraft(db, pipelineId, draft, now()),
  );

  handle(ipcMain, C.outreachTemplates, outreachTemplatesPayloadSchema, () => listTemplates(db));

  handle(ipcMain, C.outreachSaveTemplate, outreachSaveTemplatePayloadSchema, ({ id, template }) =>
    saveTemplate(db, id, template, now()),
  );

  handle(ipcMain, C.outreachDeleteTemplate, outreachDeleteTemplatePayloadSchema, ({ id }) =>
    deleteTemplate(db, id),
  );

  const backupFolder = () => {
    const chosen = getSetting(db, 'backupFolder');
    const fallback = deps.defaultBackupFolder?.();
    if (!chosen && !fallback) throw new Error('No backups folder');
    return { folder: chosen ?? fallback!, chosen: chosen !== null };
  };
  const backupInfo = () => {
    const { folder, chosen } = backupFolder();
    const backups = listBackups(folder);
    return { folder, chosen, count: backups.length, last: backups[0] ?? null };
  };
  /** The user's local day, "2026-10-16", for export names. */
  const today = () =>
    backupFileName(now(), getSetting(db, 'timezone')).slice('radar-'.length, -'.db'.length);

  handle(ipcMain, C.dataBackupInfo, dataNoPayloadSchema, () => backupInfo());

  handle(ipcMain, C.dataBackupNow, dataNoPayloadSchema, async () => {
    const r = await backupDatabase(db, backupFolder().folder, now(), getSetting(db, 'timezone'));
    return { ...backupInfo(), pruned: r.pruned.length };
  });

  handle(ipcMain, C.dataChooseBackupFolder, dataNoPayloadSchema, async () => {
    if (!deps.chooseFolder) throw new Error('Choosing a folder is not available');
    const picked = await deps.chooseFolder('Choose the backups folder', backupFolder().folder);
    if (!picked) return null;
    setSetting(db, 'backupFolder', picked);
    return backupInfo();
  });

  handle(ipcMain, C.dataOpenBackupFolder, dataNoPayloadSchema, async () => {
    if (!deps.openFolder) throw new Error('Opening folders is not available');
    const { folder } = backupFolder();
    mkdirSync(folder, { recursive: true });
    await deps.openFolder(folder);
  });

  handle(ipcMain, C.dataExportJson, dataNoPayloadSchema, async () => {
    if (!deps.saveTextFile) throw new Error('Export is not available');
    const file = await deps.saveTextFile(`radar-export-${today()}.json`, exportJson(db, now()), {
      name: 'JSON',
      extensions: ['json'],
    });
    return file ? { path: file } : null;
  });

  handle(ipcMain, C.dataExportCsv, dataNoPayloadSchema, async () => {
    if (!deps.chooseFolder) throw new Error('Export is not available');
    const parent = await deps.chooseFolder('Choose where to save the CSV files');
    if (!parent) return null;
    const folder = join(parent, `radar-export-${today()}`);
    const files = exportCsv(db, folder);
    return { path: folder, files: files.length };
  });

  handle(ipcMain, C.opportunitiesList, opportunitiesListPayloadSchema, () =>
    listOpportunityItems(db),
  );

  handle(ipcMain, C.opportunitiesSearch, opportunitiesSearchPayloadSchema, ({ query }) =>
    searchOpportunityIds(db, query),
  );

  handle(ipcMain, C.opportunitiesGet, opportunitiesGetPayloadSchema, ({ id }) => {
    const detail = getOpportunityDetail(db, id);
    if (!detail) throw new Error(`No opportunity with id ${id}`);
    return detail;
  });

  handle(ipcMain, C.opportunitiesSetStarred, opportunitiesSetStarredPayloadSchema, (p) =>
    setStarred(db, p.ids, p.starred),
  );

  handle(ipcMain, C.opportunitiesDismiss, opportunitiesIdsPayloadSchema, ({ ids }) =>
    dismissOpportunities(db, ids, now()),
  );

  handle(ipcMain, C.opportunitiesRestore, opportunitiesIdsPayloadSchema, ({ ids }) =>
    restoreOpportunities(db, ids),
  );

  handle(ipcMain, C.pipelineAdd, pipelineAddPayloadSchema, ({ opportunityIds }) =>
    addOpportunitiesToPipeline(db, opportunityIds, now()),
  );

  handle(ipcMain, C.pipelineRemove, pipelineRemovePayloadSchema, ({ ids }) => {
    const removed = removePipelineRows(db, ids);
    deps.onRemindersChanged?.();
    return removed;
  });

  handle(ipcMain, C.pipelineList, pipelineListPayloadSchema, () => listPipeline(db));

  handle(ipcMain, C.pipelineCreate, pipelineCreatePayloadSchema, ({ row }) => {
    const created = createPipelineRow(db, row, getSetting(db, 'timezone'), now());
    deps.onRemindersChanged?.();
    return created;
  });

  handle(ipcMain, C.pipelineUpdate, pipelineUpdatePayloadSchema, ({ id, patch }) => {
    const updated = updatePipelineRow(db, id, patch, getSetting(db, 'timezone'), now());
    deps.onRemindersChanged?.();
    return updated;
  });

  handle(ipcMain, C.pipelineImportCsv, pipelineImportCsvPayloadSchema, async () => {
    if (!deps.pickCsvFile || !deps.readTextFile) throw new Error('Import is not available');
    const file = await deps.pickCsvFile();
    if (!file) return null;
    const result = importPipelineCsv(
      db,
      deps.readTextFile(file),
      getSetting(db, 'timezone'),
      now(),
    );
    deps.onRemindersChanged?.();
    return { ...result, file };
  });

  // The page shows deadlines from 30 days back; older ones are not loaded.
  handle(ipcMain, C.deadlinesList, deadlinesListPayloadSchema, () => {
    const at = now();
    return listDeadlines(db, at, { from: new Date(at.getTime() - 31 * 86_400_000) });
  });

  handle(ipcMain, C.deadlinesAdd, deadlinesAddPayloadSchema, ({ deadline }) => {
    const id = addManualDeadline(db, deadline, getSetting(db, 'timezone'), now());
    deps.onRemindersChanged?.(); // plans its reminders right away
    return id;
  });

  handle(ipcMain, C.deadlinesRemove, deadlinesRemovePayloadSchema, ({ id }) =>
    removeManualDeadline(db, id),
  );

  handle(ipcMain, C.deadlinesSnooze, deadlinesSnoozePayloadSchema, ({ target, until }) => {
    if (target.kind === 'reminder') snoozeReminder(db, target.id, new Date(until));
    else snoozeTarget(db, target.type, target.id, new Date(until), now());
  });

  handle(ipcMain, C.deadlinesDone, deadlinesDonePayloadSchema, ({ target }) => {
    if (target.kind === 'target') return markTargetDone(db, target.type, target.id, now());
    markReminderDone(db, target.id, now());
    return [target.id];
  });

  handle(ipcMain, C.deadlinesUndoDone, deadlinesUndoDonePayloadSchema, ({ ids }) =>
    undoDone(db, ids),
  );

  handle(ipcMain, C.deadlinesExportIcs, deadlinesExportIcsPayloadSchema, async () => {
    if (!deps.saveTextFile) throw new Error('Export is not available');
    const at = now();
    const timeZone = getSetting(db, 'timezone');
    // Upcoming only, from a day back so a deadline that ends tonight is included.
    const from = at.getTime() - 86_400_000;
    const events = listDeadlines(db, at, { from: new Date(from) }).events.filter(
      (e) => new Date(e.at).getTime() >= from,
    );
    const file = await deps.saveTextFile('radar-deadlines.ics', toIcs(events, timeZone, at), {
      name: 'Calendar',
      extensions: ['ics'],
    });
    return file ? { file, count: events.length } : null;
  });

  handle(ipcMain, C.programsList, programsListPayloadSchema, () => listPrograms(db));

  handle(ipcMain, C.programsCreate, programsCreatePayloadSchema, ({ program }) => {
    const created = createProgram(db, program, getSetting(db, 'timezone'), now());
    deps.onRemindersChanged?.();
    return created;
  });

  handle(ipcMain, C.programsUpdate, programsUpdatePayloadSchema, ({ id, patch }) => {
    const updated = updateProgram(db, id, patch, getSetting(db, 'timezone'), now());
    deps.onRemindersChanged?.();
    return updated;
  });

  handle(ipcMain, C.programsDelete, programIdPayloadSchema, ({ id }) => {
    const removed = deleteProgram(db, id);
    deps.onRemindersChanged?.();
    return removed;
  });

  handle(ipcMain, C.programsCheck, programIdPayloadSchema, ({ id }) => {
    if (!deps.checkProgramPage) throw new Error('Checking pages is not available');
    return deps.checkProgramPage(id);
  });

  handle(ipcMain, C.programsMarkReviewed, programsMarkReviewedPayloadSchema, ({ alertId }) =>
    markAlertReviewed(db, alertId, now()),
  );

  handle(ipcMain, C.sourcesList, sourcesListPayloadSchema, () => listSourceItems(db));

  handle(ipcMain, C.sourcesSetPaused, sourcesSetPausedPayloadSchema, ({ id, paused }) =>
    setSourcePaused(db, id, paused),
  );

  handle(ipcMain, C.sourcesAdd, sourcesAddPayloadSchema, ({ source }) =>
    addSource(db, source, now()),
  );

  handle(ipcMain, C.sourcesDelete, sourceIdPayloadSchema, ({ id }) => deleteSource(db, id));

  handle(ipcMain, C.sourcesTest, sourcesTestPayloadSchema, (target) => {
    if (!deps.testSource) throw new Error('Test fetch is not available');
    const source =
      'id' in target ? adapterSourceOf(db, target.id) : adapterSourceFor(target.source);
    return deps.testSource(source);
  });

  const defaults = (): Rules => {
    const d = deps.defaultRules?.();
    if (!d) throw new Error('seeds/rules.json could not be loaded');
    return d;
  };

  handle(ipcMain, C.rulesGet, rulesGetPayloadSchema, () => {
    const d = defaults();
    return { ...effectiveRules(db, d), defaults: d };
  });

  handle(ipcMain, C.rulesSave, rulesSavePayloadSchema, async ({ rules }) => {
    saveUserRules(db, rules, now());
    return (await deps.rulesChanged?.()) ?? null;
  });

  handle(ipcMain, C.rulesReset, rulesNoPayloadSchema, async () => {
    resetUserRules(db);
    return (await deps.rulesChanged?.()) ?? null;
  });

  handle(
    ipcMain,
    C.rulesRescore,
    rulesNoPayloadSchema,
    async () => (await deps.rescoreNow?.()) ?? null,
  );

  handle(ipcMain, C.rulesPreview, rulesNoPayloadSchema, () => previewItems(db));

  handle(ipcMain, C.scanRun, scanRunPayloadSchema, (p) => deps.scan.run('manual', p?.sources));

  handle(ipcMain, C.scanStatus, scanStatusPayloadSchema, () => deps.scan.status());

  const syncOff: SyncStatus = { state: 'off', lastSyncedAt: null, pending: 0, message: null };
  handle(ipcMain, C.syncStatus, syncNoPayloadSchema, () => deps.sync?.status() ?? syncOff);
  handle(ipcMain, C.syncNow, syncNoPayloadSchema, () => deps.sync?.now() ?? syncOff);
  handle(ipcMain, C.syncUseRecoveryKey, syncRecoveryKeyPayloadSchema, ({ recoveryKey }) => {
    if (!deps.sync) throw new Error('Sync needs an account');
    return deps.sync.useRecoveryKey(recoveryKey);
  });

  handle(ipcMain, C.copilotCheck, copilotNoPayloadSchema, () => {
    if (!deps.checkCopilot) throw new Error('Radar Copilot is not available');
    return deps.checkCopilot(getSetting(db, 'copilot'));
  });
  const copilot = () => {
    if (!deps.copilot) throw new Error('Radar Copilot is not available');
    return deps.copilot;
  };
  handle(ipcMain, C.copilotList, copilotNoPayloadSchema, () => listCopilotItems(db));
  handle(ipcMain, C.copilotStatus, copilotNoPayloadSchema, () => copilot().status());
  handle(ipcMain, C.copilotReview, copilotReviewPayloadSchema, ({ ids }) => copilot().review(ids));
  handle(ipcMain, C.copilotReviewWaiting, copilotNoPayloadSchema, () => copilot().reviewWaiting());
  handle(ipcMain, C.copilotStop, copilotNoPayloadSchema, async () => {
    await copilot().stop();
    return copilot().status();
  });
  handle(ipcMain, C.copilotMakeCv, copilotReviewPayloadSchema, ({ ids }) => copilot().makeCv(ids));
  handle(
    ipcMain,
    C.copilotGetCv,
    copilotIdPayloadSchema,
    ({ id }) => getTailoredCv(db, id) ?? null,
  );
  handle(ipcMain, C.copilotSaveCvPdf, copilotIdPayloadSchema, async ({ id }) => {
    if (!deps.savePdf) throw new Error('Saving a PDF is not available');
    const stored = getTailoredCv(db, id);
    const posting = reviewInput(db, id);
    if (!stored || !posting) throw new Error('This posting has no tailored CV yet');
    const file = await deps.savePdf(cvHtml(stored.cv), cvFileName(stored.cv, posting.org));
    return file === null ? null : { file };
  });

  const devOnly = () => {
    if (windowInfo().isPackaged) throw new Error('Sample data is only available in development');
  };
  handle(ipcMain, C.devLoadSample, devPayloadSchema, () => {
    devOnly();
    return loadSampleData(db, deps.readSampleFixture(), now());
  });
  handle(ipcMain, C.devClearSample, devPayloadSchema, () => {
    devOnly();
    return clearSampleData(db);
  });

  return remove;
}
