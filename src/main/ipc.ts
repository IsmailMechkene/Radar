import type Database from 'better-sqlite3';
import type { IpcMain } from 'electron';
import { z } from 'zod';
import {
  dismissOpportunities,
  getOpportunityDetail,
  listOpportunityItems,
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
import { clearSampleData, loadSampleData } from '../core/dev/sample';
import { settingsSchema } from '../core/settings/schema';
import { getAllSettings, getSetting, setSetting } from '../core/settings/store';
import {
  appGetWindowInfoPayloadSchema,
  appOpenExternalPayloadSchema,
  devPayloadSchema,
  IPC_CHANNELS as C,
  opportunitiesGetPayloadSchema,
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
  /** Reads the dev sample fixture (raw JSON, validated by the loader). */
  readSampleFixture: () => unknown;
  scan: Pick<ScanService, 'run' | 'status'>;
  /** Called after a setting is stored (e.g. to re-score when a scoring setting changed). */
  onSettingChanged?: (key: string) => void;
  /** Native "open file" dialog for a CSV; resolves to the path, or null when cancelled. */
  pickCsvFile?: () => Promise<string | null>;
  readTextFile?: (path: string) => string;
  /** Called after the pipeline changed (e.g. to plan follow-up reminders right away). */
  onPipelineChanged?: () => void;
  /** Native "save file" dialog; writes the text and resolves to the path, or null when cancelled. */
  saveTextFile?: (suggestedName: string, contents: string) => Promise<string | null>;
  now?: () => Date;
}

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
  ipcMain.handle(channel, async (_event, payload: unknown) => {
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

  handle(ipcMain, C.opportunitiesList, opportunitiesListPayloadSchema, () =>
    listOpportunityItems(db),
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
    deps.onPipelineChanged?.();
    return removed;
  });

  handle(ipcMain, C.pipelineList, pipelineListPayloadSchema, () => listPipeline(db));

  handle(ipcMain, C.pipelineCreate, pipelineCreatePayloadSchema, ({ row }) => {
    const created = createPipelineRow(db, row, getSetting(db, 'timezone'), now());
    deps.onPipelineChanged?.();
    return created;
  });

  handle(ipcMain, C.pipelineUpdate, pipelineUpdatePayloadSchema, ({ id, patch }) => {
    const updated = updatePipelineRow(db, id, patch, getSetting(db, 'timezone'), now());
    deps.onPipelineChanged?.();
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
    deps.onPipelineChanged?.();
    return { ...result, file };
  });

  handle(ipcMain, C.deadlinesList, deadlinesListPayloadSchema, () => listDeadlines(db, now()));

  handle(ipcMain, C.deadlinesAdd, deadlinesAddPayloadSchema, ({ deadline }) => {
    const id = addManualDeadline(db, deadline, getSetting(db, 'timezone'), now());
    deps.onPipelineChanged?.(); // plans its reminders right away
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
    const file = await deps.saveTextFile('radar-deadlines.ics', toIcs(events, timeZone, at));
    return file ? { file, count: events.length } : null;
  });

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
