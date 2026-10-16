import type Database from 'better-sqlite3';
import type { IpcMain } from 'electron';
import { z } from 'zod';
import { settingsSchema } from '../core/settings/schema';
import { getAllSettings, getSetting, setSetting } from '../core/settings/store';
import {
  appGetWindowInfoPayloadSchema,
  IPC_CHANNELS,
  settingsGetAllPayloadSchema,
  settingsGetPayloadSchema,
  settingsSetPayloadSchema,
  type IpcChannel,
  type WindowInfo,
} from '../shared/ipc';
import type { ThemePreference } from '../shared/theme';

export interface IpcDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  db: Database.Database;
  applyAutostart: (enabled: boolean) => void;
  applyTheme: (theme: ThemePreference) => void;
  windowInfo: () => WindowInfo;
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
  ipcMain.handle(channel, (_event, payload: unknown) => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const message = `${channel}: invalid payload\n${z.prettifyError(parsed.error)}`;
      console.error(`[ipc] ${message}`);
      throw new Error(message);
    }
    try {
      return fn(parsed.data);
    } catch (err) {
      const message = `${channel} failed: ${describe(err)}`;
      console.error(`[ipc] ${message}`);
      throw new Error(message, { cause: err });
    }
  });
}

export function registerIpcHandlers({
  ipcMain,
  db,
  applyAutostart,
  applyTheme,
  windowInfo,
}: IpcDeps): void {
  handle(ipcMain, IPC_CHANNELS.settingsGetAll, settingsGetAllPayloadSchema, () =>
    getAllSettings(db),
  );

  handle(ipcMain, IPC_CHANNELS.settingsGet, settingsGetPayloadSchema, ({ key }) =>
    getSetting(db, key),
  );

  handle(ipcMain, IPC_CHANNELS.settingsSet, settingsSetPayloadSchema, ({ key, value }) => {
    if (key === 'autostart') {
      // Apply to the OS first so the stored value never claims something that failed.
      applyAutostart(settingsSchema.shape.autostart.parse(value));
    }
    const stored = setSetting(db, key, value);
    if (key === 'theme') applyTheme(settingsSchema.shape.theme.parse(stored));
    return stored;
  });

  handle(ipcMain, IPC_CHANNELS.appGetWindowInfo, appGetWindowInfoPayloadSchema, () => windowInfo());
}
