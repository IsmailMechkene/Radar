import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { getSetting, seedDefaultSettings } from '../src/core/settings/store';
import { createHttpClient, type FetchFn } from '../src/core/http/client';
import { parseSeedSources } from '../src/core/sources/seeds';
import { syncSeedSources } from '../src/core/sources/sync';
import { registerIpcHandlers, registerShellHandlers } from '../src/main/ipc';
import { createScanService } from '../src/main/scan';
import {
  IPC_CHANNELS,
  SHELL_CHANNELS,
  type AuthStatus,
  type OpportunityListItem,
  type PipelineImport,
  type PipelineItem,
  type ScanProgress,
  type ScanStatus,
  type ScanSummary,
  type WindowInfo,
} from '../src/shared/ipc';
import type { ResolvedTheme, ThemePreference } from '../src/shared/theme';
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
  let setChromeTheme: Mock<(theme: ResolvedTheme, dimmed: boolean) => void>;
  let openExternal: Mock<(url: string) => Promise<void>>;
  let info: WindowInfo;
  let changed: string[];
  let progress: ScanProgress[];
  let finished: ScanSummary[];
  let pipelineChanges: number;
  let csvPick: string | null;
  let dataDir: string;
  let folderPick: string | null;
  let saved: { name: string; contents: string } | null;
  let unregister: () => void;
  let scanService: ReturnType<typeof createScanService>;
  let unlockCalls: string[];
  let signUps: string[];

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    seedDefaultSettings(t.db);
    handlers = new Map();
    applyAutostart = vi.fn<(enabled: boolean) => void>();
    applyTheme = vi.fn<(theme: ThemePreference) => void>();
    setChromeTheme = vi.fn<(theme: ResolvedTheme, dimmed: boolean) => void>();
    openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
    info = { platform: 'win32', isPackaged: false, material: 'none' };
    changed = [];
    progress = [];
    finished = [];
    pipelineChanges = 0;
    csvPick = null;
    dataDir = mkdtempSync(join(tmpdir(), 'radar-data-'));
    folderPick = null;
    saved = null;
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
    scanService = scan;
    const ipcMain = {
      handle: (channel: string, fn: Handler) => void handlers.set(channel, fn),
      removeHandler: (channel: string) => void handlers.delete(channel),
    };
    unlockCalls = [];
    signUps = [];
    const status = (): AuthStatus => ({
      state: 'unlocked',
      recoveryKey: null,
      account: null,
      session: null,
    });
    const flow = async () => status();
    registerShellHandlers({
      ipcMain,
      windowInfo: () => info,
      setChromeTheme,
      auth: {
        status,
        setup: async () => status(),
        unlock: async (password) => {
          unlockCalls.push(password);
          return status();
        },
        recover: flow,
        confirmRecoveryKey: flow,
        lock: async () => ({ state: 'locked', account: null }),
        createAccount: async (email) => {
          signUps.push(email);
          return status();
        },
        signIn: flow,
        google: flow,
        cancel: flow,
        emailConfirmed: flow,
        resendEmail: flow,
        requestReset: flow,
        setNewPassword: flow,
        choosePassword: flow,
        finishPasswordChange: flow,
        signOut: flow,
      },
    });
    unregister = registerIpcHandlers({
      ipcMain,
      db: t.db,
      applyAutostart,
      applyTheme,
      windowInfo: () => info,
      openExternal,
      readSampleFixture: fixture,
      scan,
      onSettingChanged: (key) => changed.push(key),
      pickCsvFile: async () => csvPick,
      readTextFile: (path) => readFileSync(path, 'utf8'),
      defaultBackupFolder: () => join(dataDir, 'Backups'),
      chooseFolder: async () => folderPick,
      saveTextFile: async (name, contents) => {
        saved = { name, contents };
        const file = join(dataDir, name);
        writeFileSync(file, contents);
        return file;
      },
      onRemindersChanged: () => void (pipelineChanges += 1),
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
    expect([...handlers.keys()].sort()).toEqual(
      [...Object.values(IPC_CHANNELS), ...Object.values(SHELL_CHANNELS)].sort(),
    );
  });

  it('lock removes every data channel and keeps the shell ones', async () => {
    unregister();
    expect([...handlers.keys()].sort()).toEqual(Object.values(SHELL_CHANNELS).sort());
    expect(await invoke(SHELL_CHANNELS.authUnlock, { password: 'correct horse' })).toMatchObject({
      state: 'unlocked',
      recoveryKey: null,
    });
    expect(unlockCalls).toEqual(['correct horse']);
    await expect(invoke(SHELL_CHANNELS.authUnlock, { password: '' })).rejects.toThrow(
      /invalid payload/,
    );
    // Account flows validate the email before they reach the account service.
    await invoke(SHELL_CHANNELS.authCreateAccount, {
      email: 'me@example.com',
      password: 'x'.repeat(9),
    });
    expect(signUps).toEqual(['me@example.com']);
    await expect(
      invoke(SHELL_CHANNELS.authCreateAccount, { email: 'not an email', password: 'x'.repeat(9) }),
    ).rejects.toThrow(/invalid payload/);
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
    expect(await invoke(SHELL_CHANNELS.appGetWindowInfo)).toEqual(info);
  });

  it('recolors the window controls only when the page reports its painted theme', async () => {
    await invoke(IPC_CHANNELS.settingsSet, { key: 'theme', value: 'dark' });
    expect(setChromeTheme).not.toHaveBeenCalled();
    await invoke(SHELL_CHANNELS.appChromeTheme, { theme: 'dark' });
    expect(setChromeTheme).toHaveBeenCalledWith('dark', false);
    // A dialog scrim dims the native controls too.
    await invoke(SHELL_CHANNELS.appChromeTheme, { theme: 'dark', dimmed: true });
    expect(setChromeTheme).toHaveBeenLastCalledWith('dark', true);
    for (const theme of ['system', 'sepia', undefined]) {
      await expect(invoke(SHELL_CHANNELS.appChromeTheme, { theme })).rejects.toThrow(
        /invalid payload/,
      );
    }
    await expect(
      invoke(SHELL_CHANNELS.appChromeTheme, { theme: 'dark', dimmed: 'yes' }),
    ).rejects.toThrow(/invalid payload/);
    expect(setChromeTheme).toHaveBeenCalledTimes(2);
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

  it('lock stops a running scan after its current source and refuses new ones', async () => {
    const seeds = JSON.parse(
      readFileSync(join(__dirname, '../seeds/sources.json'), 'utf8'),
    ) as unknown;
    syncSeedSources(t.db, parseSeedSources(seeds), NOW);
    const running = scanService.run('manual');
    await scanService.stop();
    const summary = await running;
    expect(summary.outcomes.length).toBeLessThan(6);
    expect(summary.errorSummary).toMatch(/Stopped early: \d+ source\(s\) not scanned/);
    expect(finished).toEqual([]); // no re-scoring or alerts once locked
    await expect(scanService.run('manual')).rejects.toThrow(/locked/);
  });

  it('tells main which setting changed (scoring settings trigger a re-score)', async () => {
    await invoke(IPC_CHANNELS.settingsSet, { key: 'targetRegions', value: ['Europe'] });
    await expect(
      invoke(IPC_CHANNELS.settingsSet, { key: 'scanIntervalHours', value: 0 }),
    ).rejects.toThrow();
    expect(changed).toEqual(['targetRegions']); // rejected values do not notify
  });

  it('lists, creates, updates (Sent starts follow-ups) and removes pipeline rows', async () => {
    const created = (await invoke(IPC_CHANNELS.pipelineCreate, {
      row: { org: 'Weaviate', role: 'Backend Intern', planned_send_date: '2026-10-21' },
    })) as PipelineItem;
    expect(created).toMatchObject({ org: 'Weaviate', status: 'not_started' });
    const sent = (await invoke(IPC_CHANNELS.pipelineUpdate, {
      id: created.id,
      patch: { status: 'sent' },
    })) as PipelineItem;
    expect(sent.sent_at).toBe(NOW.toISOString());
    expect(sent.followup1_at).toBe('2026-10-23T08:00:00.000Z'); // +7 days, 09:00 in Tunis
    expect(((await invoke(IPC_CHANNELS.pipelineList)) as PipelineItem[]).map((r) => r.org)).toEqual(
      ['Weaviate'],
    );
    await expect(
      invoke(IPC_CHANNELS.pipelineUpdate, { id: created.id, patch: { status: 'waiting' } }),
    ).rejects.toThrow(/invalid payload/);
    await expect(invoke(IPC_CHANNELS.pipelineCreate, { row: { org: '' } })).rejects.toThrow(
      /invalid payload/,
    );
    expect(await invoke(IPC_CHANNELS.pipelineRemove, { ids: [created.id] })).toBe(1);
    expect(pipelineChanges).toBe(3); // create, update, remove
  });

  it('imports a CSV chosen in the dialog; a cancelled dialog imports nothing', async () => {
    expect(await invoke(IPC_CHANNELS.pipelineImportCsv)).toBeNull();
    csvPick = join(__dirname, '../fixtures/pipeline/outreach-tracker.csv');
    const r = (await invoke(IPC_CHANNELS.pipelineImportCsv)) as PipelineImport;
    expect(r).toMatchObject({ added: 13, skipped: 0, file: csvPick });
    expect(pipelineChanges).toBe(1);
  });

  it('backs up to the default folder, then to a chosen one, and exports JSON and CSV', async () => {
    try {
      expect(await invoke(IPC_CHANNELS.dataBackupInfo)).toMatchObject({
        chosen: false,
        count: 0,
        last: null,
      });
      const first = (await invoke(IPC_CHANNELS.dataBackupNow)) as { folder: string; count: number };
      expect(first).toMatchObject({ folder: join(dataDir, 'Backups'), count: 1, pruned: 0 });
      expect(await invoke(IPC_CHANNELS.dataChooseBackupFolder)).toBeNull(); // cancelled
      folderPick = join(dataDir, 'Mine');
      expect(await invoke(IPC_CHANNELS.dataChooseBackupFolder)).toMatchObject({
        folder: folderPick,
        chosen: true,
        count: 0,
      });
      await invoke(IPC_CHANNELS.dataBackupNow);
      expect(readdirSync(folderPick)).toEqual(['radar-2026-10-16.db']);

      const json = (await invoke(IPC_CHANNELS.dataExportJson)) as { path: string };
      expect(saved!.name).toBe('radar-export-2026-10-16.json');
      expect(JSON.parse(saved!.contents)).toMatchObject({ app: 'Radar' });
      expect(existsSync(json.path)).toBe(true);
      folderPick = dataDir;
      const csv = (await invoke(IPC_CHANNELS.dataExportCsv)) as { path: string; files: number };
      expect(csv.path).toBe(join(dataDir, 'radar-export-2026-10-16'));
      expect(csv.files).toBeGreaterThan(10);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
