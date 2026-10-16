import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { getSetting, seedDefaultSettings } from '../src/core/settings/store';
import { createHttpClient, type FetchFn } from '../src/core/http/client';
import { parseSeedSources } from '../src/core/sources/seeds';
import { syncSeedSources } from '../src/core/sources/sync';
import { registerIpcHandlers } from '../src/main/ipc';
import { createScanService } from '../src/main/scan';
import {
  IPC_CHANNELS,
  type OpportunityListItem,
  type ScanProgress,
  type ScanStatus,
  type ScanSummary,
  type WindowInfo,
} from '../src/shared/ipc';
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
  let changed: string[];
  let progress: ScanProgress[];
  let finished: ScanSummary[];

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    seedDefaultSettings(t.db);
    handlers = new Map();
    applyAutostart = vi.fn<(enabled: boolean) => void>();
    applyTheme = vi.fn<(theme: ThemePreference) => void>();
    openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
    info = { platform: 'win32', isPackaged: false, material: 'none' };
    changed = [];
    progress = [];
    finished = [];
    // Only the Weaviate board answers (it serves the recorded Cohere payload); everything else,
    // robots.txt included, is 404.
    const weaviate = readFileSync(
      join(__dirname, '../fixtures/ashby/cohere-job-board.json'),
      'utf8',
    );
    const fetchFn: FetchFn = async (url) =>
      url.endsWith('/job-board/weaviate')
        ? new Response(weaviate)
        : new Response('', { status: 404 });
    const scan = createScanService({
      db: t.db,
      http: createHttpClient({ fetch: fetchFn, now: () => 0, sleep: async () => {} }),
      now: () => NOW,
      onProgress: (p) => progress.push(p),
      onFinished: (r) => finished.push(r),
    });
    registerIpcHandlers({
      ipcMain: { handle: (channel: string, fn: Handler) => void handlers.set(channel, fn) },
      db: t.db,
      applyAutostart,
      applyTheme,
      windowInfo: () => info,
      openExternal,
      readSampleFixture: fixture,
      scan,
      onSettingChanged: (key) => changed.push(key),
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

  it('runs a scan, reports progress and status, and refuses a second concurrent scan', async () => {
    const seeds = JSON.parse(
      readFileSync(join(__dirname, '../seeds/sources.json'), 'utf8'),
    ) as unknown;
    syncSeedSources(t.db, parseSeedSources(seeds), NOW);
    const before = (await invoke(IPC_CHANNELS.scanStatus)) as ScanStatus;
    expect(before).toMatchObject({
      running: false,
      sourceCount: 6,
      lastRun: null,
      lastSuccessAt: null,
    });

    const first = invoke(IPC_CHANNELS.scanRun, { sources: ['Weaviate'] });
    await expect(invoke(IPC_CHANNELS.scanRun)).rejects.toThrow(/already running/);
    const summary = (await first) as ScanSummary;
    expect(summary).toMatchObject({ sourcesOk: 1, sourcesFailed: 0, newItems: 3 });
    expect(progress).toHaveLength(1);
    expect(finished).toHaveLength(1);

    const after = (await invoke(IPC_CHANNELS.scanStatus)) as ScanStatus;
    expect(after.running).toBe(false);
    expect(after.lastRun).toMatchObject({ trigger: 'manual', sources_ok: 1, new_items: 3 });
    expect(after.lastSuccessAt).toBe(NOW.toISOString());

    // A failing source is recorded, not thrown.
    const failed = (await invoke(IPC_CHANNELS.scanRun, { sources: ['Cohere'] })) as ScanSummary;
    expect(failed).toMatchObject({ sourcesOk: 0, sourcesFailed: 1 });
    expect(failed.errorSummary).toMatch(/Cohere: .*404/);
    await expect(invoke(IPC_CHANNELS.scanRun, { sources: [] })).rejects.toThrow(/invalid payload/);
  });

  it('tells main which setting changed (scoring settings trigger a re-score)', async () => {
    await invoke(IPC_CHANNELS.settingsSet, { key: 'targetRegions', value: ['Europe'] });
    await expect(
      invoke(IPC_CHANNELS.settingsSet, { key: 'scanIntervalHours', value: 0 }),
    ).rejects.toThrow();
    expect(changed).toEqual(['targetRegions']); // rejected values do not notify
  });
});
