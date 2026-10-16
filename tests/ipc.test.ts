import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { getSetting, seedDefaultSettings } from '../src/core/settings/store';
import { registerIpcHandlers } from '../src/main/ipc';
import { IPC_CHANNELS, type WindowInfo } from '../src/shared/ipc';
import type { ThemePreference } from '../src/shared/theme';
import { tempDb } from './helpers';

type Handler = (event: IpcMainInvokeEvent, payload?: unknown) => unknown;

describe('IPC handlers validate payloads', () => {
  let t: ReturnType<typeof tempDb>;
  let handlers: Map<string, Handler>;
  let applyAutostart: Mock<(enabled: boolean) => void>;
  let applyTheme: Mock<(theme: ThemePreference) => void>;
  const info: WindowInfo = { platform: 'win32', isPackaged: false, material: 'none' };

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    seedDefaultSettings(t.db);
    handlers = new Map();
    applyAutostart = vi.fn<(enabled: boolean) => void>();
    applyTheme = vi.fn<(theme: ThemePreference) => void>();
    registerIpcHandlers({
      ipcMain: { handle: (channel: string, fn: Handler) => void handlers.set(channel, fn) },
      db: t.db,
      applyAutostart,
      applyTheme,
      windowInfo: () => info,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    t.cleanup();
  });

  const invoke = (channel: string, payload?: unknown) =>
    handlers.get(channel)!({} as IpcMainInvokeEvent, payload);

  it('registers every channel', () => {
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC_CHANNELS).sort());
  });

  it('rejects malformed payloads and bad values', () => {
    expect(() => invoke(IPC_CHANNELS.settingsGet, { key: 'nope' })).toThrow(/invalid payload/);
    expect(() =>
      invoke(IPC_CHANNELS.settingsSet, { key: 'timezone', value: 'X/Y', extra: 1 }),
    ).toThrow(/invalid payload/);
    expect(() => invoke(IPC_CHANNELS.settingsSet, { key: 'scanIntervalHours', value: -1 })).toThrow(
      /failed/,
    );
    expect(getSetting(t.db, 'scanIntervalHours')).toBe(6);
  });

  it('applies autostart to the OS before storing it', () => {
    expect(invoke(IPC_CHANNELS.settingsSet, { key: 'autostart', value: true })).toBe(true);
    expect(applyAutostart).toHaveBeenCalledWith(true);
    expect(getSetting(t.db, 'autostart')).toBe(true);

    applyAutostart.mockImplementation(() => {
      throw new Error('OS refused');
    });
    expect(() => invoke(IPC_CHANNELS.settingsSet, { key: 'autostart', value: false })).toThrow(
      /OS refused/,
    );
    expect(getSetting(t.db, 'autostart')).toBe(true);
  });

  it('applies a stored theme to the native chrome and serves window info', () => {
    expect(invoke(IPC_CHANNELS.settingsSet, { key: 'theme', value: 'dark' })).toBe('dark');
    expect(applyTheme).toHaveBeenCalledWith('dark');
    expect(() => invoke(IPC_CHANNELS.settingsSet, { key: 'theme', value: 'sepia' })).toThrow();
    expect(applyTheme).toHaveBeenCalledOnce();
    expect(invoke(IPC_CHANNELS.appGetWindowInfo)).toEqual(info);
  });
});
