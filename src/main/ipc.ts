import type Database from 'better-sqlite3';
import type { IpcMain } from 'electron';
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
import { settingsSchema } from '../core/settings/schema';
import { getAllSettings, getSetting, setSetting } from '../core/settings/store';
import {
  appGetWindowInfoPayloadSchema,
  appOpenExternalPayloadSchema,
  appNavCountsPayloadSchema,
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
  settingsGetAllPayloadSchema,
  settingsGetPayloadSchema,
  settingsSetPayloadSchema,
  type IpcChannel,
  type WindowInfo,
} from '../shared/ipc';
import type { ThemePreference } from '../shared/theme';
import type { ScanService } from './scan';

export interface IpcDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
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
  rulesChanged?: () => RescoreResult | null;
  rescoreNow?: () => RescoreResult | null;
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
  ipcMain: IpcDeps['ipcMain'],
  channel: IpcChannel,
  schema: S,
  fn: (payload: z.output<S>) => unknown,
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
      return await fn(parsed.data);
    } catch (err) {
      const message = `${channel} failed: ${describe(err)}`;
      console.error(`[ipc] ${message}`);
      throw new Error(message, { cause: err });
    }
  });
}

export function registerIpcHandlers(deps: IpcDeps): void {
  trustedSender = deps.isTrustedSender;
  const { ipcMain, db, applyAutostart, applyTheme, windowInfo } = deps;
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

  handle(ipcMain, C.appGetWindowInfo, appGetWindowInfoPayloadSchema, () => windowInfo());

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

  handle(ipcMain, C.deadlinesList, deadlinesListPayloadSchema, () => listDeadlines(db, now()));

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
    const events = listDeadlines(db, at).events.filter((e) => new Date(e.at).getTime() >= from);
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

  handle(ipcMain, C.rulesSave, rulesSavePayloadSchema, ({ rules }) => {
    saveUserRules(db, rules, now());
    return deps.rulesChanged?.() ?? null;
  });

  handle(ipcMain, C.rulesReset, rulesNoPayloadSchema, () => {
    resetUserRules(db);
    return deps.rulesChanged?.() ?? null;
  });

  handle(ipcMain, C.rulesRescore, rulesNoPayloadSchema, () => deps.rescoreNow?.() ?? null);

  handle(ipcMain, C.rulesPreview, rulesNoPayloadSchema, () => previewItems(db));

  handle(ipcMain, C.scanRun, scanRunPayloadSchema, (p) => deps.scan.run('manual', p?.sources));

  handle(ipcMain, C.scanStatus, scanStatusPayloadSchema, () => deps.scan.status());

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
}
