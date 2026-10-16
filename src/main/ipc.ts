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
import { addOpportunitiesToPipeline, removePipelineRows } from '../core/db/pipeline';
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

  handle(ipcMain, C.pipelineRemove, pipelineRemovePayloadSchema, ({ ids }) =>
    removePipelineRows(db, ids),
  );

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
