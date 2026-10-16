import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { getSetting, seedDefaultSettings } from '../src/core/settings/store';
import { registerIpcHandlers } from '../src/main/ipc';
import { IPC_CHANNELS, type OpportunityListItem, type WindowInfo } from '../src/shared/ipc';
import type { ThemePreference } from '../src/shared/theme';
import { tempDb } from './helpers';

type Handler = (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>;
const NOW = new Date('2026-10-16T08:00:00.000Z');
const fixture = () =>
  JSON.parse(
    readFileSync(join(__dirname, '../fixtures/sample-opportunities.json'), 'utf8'),
  ) as unknown;

describe('IPC handlers', () => {
  let t: ReturnType<typeof tempDb>;
  let handlers: Map<string, Handler>;
  let applyAutostart: Mock<(enabled: boolean) => void>;
  let applyTheme: Mock<(theme: ThemePreference) => void>;
  let openExternal: Mock<(url: string) => Promise<void>>;
  let info: WindowInfo;

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    seedDefaultSettings(t.db);
    handlers = new Map();
    applyAutostart = vi.fn<(enabled: boolean) => void>();
    applyTheme = vi.fn<(theme: ThemePreference) => void>();
    openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
    info = { platform: 'win32', isPackaged: false, material: 'none' };
    registerIpcHandlers({
      ipcMain: { handle: (channel: string, fn: Handler) => void handlers.set(channel, fn) },
      db: t.db,
      applyAutostart,
      applyTheme,
      windowInfo: () => info,
      openExternal,
      readSampleFixture: fixture,
      now: () => NOW,
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

  it('rejects malformed payloads and bad values', async () => {
    await expect(invoke(IPC_CHANNELS.settingsGet, { key: 'nope' })).rejects.toThrow(
      /invalid payload/,
    );
    await expect(
      invoke(IPC_CHANNELS.settingsSet, { key: 'timezone', value: 'X/Y', extra: 1 }),
    ).rejects.toThrow(/invalid payload/);
    await expect(
      invoke(IPC_CHANNELS.settingsSet, { key: 'scanIntervalHours', value: -1 }),
    ).rejects.toThrow(/failed/);
    expect(getSetting(t.db, 'scanIntervalHours')).toBe(6);
  });

  it('applies autostart to the OS before storing it', async () => {
    expect(await invoke(IPC_CHANNELS.settingsSet, { key: 'autostart', value: true })).toBe(true);
    expect(applyAutostart).toHaveBeenCalledWith(true);
    expect(getSetting(t.db, 'autostart')).toBe(true);

    applyAutostart.mockImplementation(() => {
      throw new Error('OS refused');
    });
    await expect(
      invoke(IPC_CHANNELS.settingsSet, { key: 'autostart', value: false }),
    ).rejects.toThrow(/OS refused/);
    expect(getSetting(t.db, 'autostart')).toBe(true);
  });

  it('applies a stored theme to the native chrome and serves window info', async () => {
    expect(await invoke(IPC_CHANNELS.settingsSet, { key: 'theme', value: 'dark' })).toBe('dark');
    expect(applyTheme).toHaveBeenCalledWith('dark');
    await expect(
      invoke(IPC_CHANNELS.settingsSet, { key: 'theme', value: 'sepia' }),
    ).rejects.toThrow();
    expect(applyTheme).toHaveBeenCalledOnce();
    expect(await invoke(IPC_CHANNELS.appGetWindowInfo)).toEqual(info);
  });

  it('opens only http(s) links', async () => {
    await invoke(IPC_CHANNELS.appOpenExternal, { url: 'https://example.com/apply' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/apply');
    for (const url of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'nope']) {
      await expect(invoke(IPC_CHANNELS.appOpenExternal, { url })).rejects.toThrow(
        /invalid payload/,
      );
    }
    expect(openExternal).toHaveBeenCalledOnce();
  });

  it('serves opportunities, stars, dismisses, restores and adds to pipeline', async () => {
    expect(await invoke(IPC_CHANNELS.opportunitiesList)).toEqual([]);
    expect(await invoke(IPC_CHANNELS.devLoadSample)).toBe(17);

    const list = (await invoke(IPC_CHANNELS.opportunitiesList)) as OpportunityListItem[];
    expect(list).toHaveLength(17);
    const top = list[0]!;
    expect(top.score).toBe(92);
    expect(top.summary).toBe('AI/ML title, internship, remote, visa friendly');
    expect(top.source_count).toBe(3);

    expect(
      await invoke(IPC_CHANNELS.opportunitiesSetStarred, { ids: [top.id], starred: false }),
    ).toBe(1);
    expect(await invoke(IPC_CHANNELS.opportunitiesDismiss, { ids: [top.id] })).toBe(1);
    expect(await invoke(IPC_CHANNELS.opportunitiesList)).toHaveLength(16);
    expect(await invoke(IPC_CHANNELS.opportunitiesRestore, { ids: [top.id] })).toBe(1);
    expect(await invoke(IPC_CHANNELS.opportunitiesList)).toHaveLength(17);

    const added = (await invoke(IPC_CHANNELS.pipelineAdd, {
      opportunityIds: [top.id, top.id],
    })) as { added: number[]; skipped: number };
    expect(added.added).toHaveLength(1);
    expect(added.skipped).toBe(0);
    expect(await invoke(IPC_CHANNELS.pipelineAdd, { opportunityIds: [top.id] })).toEqual({
      added: [],
      skipped: 1,
    });
    expect(await invoke(IPC_CHANNELS.pipelineRemove, { ids: added.added })).toBe(1);

    await expect(invoke(IPC_CHANNELS.opportunitiesGet, { id: 999_999 })).rejects.toThrow(
      /No opportunity/,
    );
    await expect(invoke(IPC_CHANNELS.opportunitiesDismiss, { ids: [] })).rejects.toThrow(
      /invalid payload/,
    );
  });

  it('refuses sample data in packaged builds', async () => {
    info = { ...info, isPackaged: true };
    await expect(invoke(IPC_CHANNELS.devLoadSample)).rejects.toThrow(
      /only available in development/,
    );
    await expect(invoke(IPC_CHANNELS.devClearSample)).rejects.toThrow(
      /only available in development/,
    );
  });
});
