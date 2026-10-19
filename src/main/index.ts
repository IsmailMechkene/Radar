import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  clipboard,
  powerMonitor,
  safeStorage,
  session as electronSession,
  shell,
  Tray,
  type BrowserWindowConstructorOptions,
} from 'electron';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { syncReminders } from '../core/reminders/store';
import { release, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type Database from 'better-sqlite3-multiple-ciphers';
import { migrate } from '../core/db/migrate';
import { openDatabase, resolveDbPath } from '../core/db/open';
import { dueMatchAlerts, type MatchAlert } from '../core/alerts/matches';
import { extractDeadlinesAsync } from '../core/deadlines/postings';
import { createHttpClient } from '../core/http/client';
import { parseSeedPrograms, syncSeedPrograms } from '../core/programs/seeds';
import type { Notice } from '../core/reminders/store';
import { compileRules, type CompiledRules } from '../core/rules/engine';
import type { RescoreResult } from '../core/rules/rescore';
import type { Rules } from '../core/rules/schema';
import { effectiveRules } from '../core/rules/store';
import { profileFromSettings, SCORING_SETTING_KEYS } from '../core/rules/profile';
import { rescoreAllAsync } from '../core/rules/rescore';
import { parseRules } from '../core/rules/schema';
import { getAllSettings, getSetting, seedDefaultSettings } from '../core/settings/store';
import { parseSeedSources } from '../core/sources/seeds';
import { syncSeedSources } from '../core/sources/sync';
import { IPC_EVENTS, type AuthStatus, type WindowInfo } from '../shared/ipc';
import {
  WINDOW_BACKGROUND,
  type ResolvedTheme,
  type ThemePreference,
  type WindowAction,
  type WindowState,
} from '../shared/theme';
import { registerIpcHandlers, registerShellHandlers } from './ipc';
import { createVault, type Vault } from './vault';
import { createAuth, type Auth } from './auth';
import { CALLBACK_URL, startCallbackServer } from './account/callback-server';
import {
  createSupabaseAccount,
  createSupabaseClient,
  type AccountService,
} from './account/service';
import { createSupabaseRemote, type AccountRemote } from './account/remote';
import { createSyncService, type SyncService } from './sync';
import type { SyncResult } from '../core/sync/engine';
import { relinkPipeline } from '../core/sync/entities';
import { quietly } from '../core/sync/state';
import { createSessionStore } from './account/session-store';
import { prepareEncryptedDatabase } from '../core/vault/encrypt';
import { applyAutostart, createLifecycle, type WindowKind } from './lifecycle';
import { createScanService, type ScanService } from './scan';
import { createScheduler, type Scheduler } from './scheduler';
import { checkPage, watchPages } from '../core/watch/pages';
import { getSource } from '../core/db/sources';
import { testFetch } from '../core/sources/manage';
import { ensureDefaultTemplates } from '../core/outreach';
import { backupDatabase, hasBackupFor } from '../core/backup';
import { chooseWindowMaterial } from './window-material';

// `npm run shot`: capture screenshots against a throwaway profile, never the user's data.
const SHOT_MODE = process.argv.includes('--radar-shot');
if (SHOT_MODE) app.setPath('userData', join(tmpdir(), `radar-shot-${process.pid}`));
// Development only: RADAR_USER_DATA points a second instance at its own profile (own DB and
// single-instance lock), e.g. for UI tests while your normal dev app keeps running.
else if (!app.isPackaged && process.env['RADAR_USER_DATA']) {
  app.setPath('userData', process.env['RADAR_USER_DATA']);
}

const material = chooseWindowMaterial(process.platform, release());
const windowInfo = (): WindowInfo => ({
  platform: process.platform,
  isPackaged: app.isPackaged,
  material,
});

let tray: Tray | null = null;
// Notifications are kept referenced until closed, or their click handler can be collected.
const liveNotifications = new Set<Notification>();

const lifecycle = createLifecycle({
  app,
  createWindow,
  // The login window until unlocked and the recovery key is saved; then the app window.
  windowKind: () => {
    const s = auth?.status();
    return s?.state === 'unlocked' && !s.recoveryKey ? 'app' : 'lock';
  },
  lock: {
    available: () => auth?.status().state === 'unlocked',
    run: () =>
      void auth?.lock().catch((err: unknown) => console.error('[radar] lock failed:', err)),
  },
});

function windowBackground(): string {
  return WINDOW_BACKGROUND[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
}

/**
 * Frameless on every platform. Windows and Linux get no native buttons: the page draws minimize,
 * maximize and close (components/WindowControls.tsx), so they dim under dialogs, blur and change
 * theme with the page. Resizing, snapping and double-click to maximize stay native.
 */
function chromeOptions(kind: WindowKind): BrowserWindowConstructorOptions {
  if (kind === 'lock') {
    // Its own top rows are the drag region; the buttons sit above the radar panel.
    return process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 20, y: 15 } }
      : { titleBarStyle: 'hidden', backgroundColor: windowBackground() };
  }
  if (process.platform === 'darwin') {
    // macOS: native traffic lights over a vibrant sidebar. Kept for later; untested on Windows.
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 20 },
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    };
  }
  return {
    titleBarStyle: 'hidden',
    ...(material === 'mica'
      ? { backgroundMaterial: 'mica', backgroundColor: '#00000000' }
      : { backgroundColor: windowBackground() }),
  };
}

/** Radar's own page: the dev server in development, the bundled file otherwise. */
function isAppUrl(url: string | undefined): boolean {
  if (!url) return false;
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl && url.startsWith(devUrl)) return true;
  return url.startsWith(pathToFileURL(join(__dirname, '../renderer/')).toString());
}

function createWindow(kind: WindowKind, onShown?: () => void): BrowserWindow {
  const size: BrowserWindowConstructorOptions =
    kind === 'lock'
      ? { width: 1080, height: 680, minWidth: 900, minHeight: 600, center: true }
      : { width: 1440, height: 900, minWidth: 1100, minHeight: 700 };
  const win = new BrowserWindow({
    ...size,
    show: false,
    title: 'Radar',
    ...(process.platform === 'darwin' ? {} : { icon: appIconPath() }),
    autoHideMenuBar: true,
    ...chromeOptions(kind),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The page's window buttons follow the window: restore vs maximize, dimmed when inactive.
  const sendState = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.windowState, windowStateOf(win));
  };
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  win.on('restore', sendState);
  win.on('focus', sendState);
  win.on('blur', sendState);
  win.on('enter-full-screen', sendState);
  win.on('leave-full-screen', sendState);
  // The app opens maximized (full work area), not at a fixed size; the login window centred.
  win.once('ready-to-show', () => {
    if (kind === 'app') win.maximize();
    win.show();
    win.focus();
    onShown?.();
  });
  // Links never open inside the app: new windows are denied and off-app navigation is blocked.
  // External links go through window.radar.app.openExternal (http/https only).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  // No <webview> may be attached (the app never uses one).
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.on('close', (event) => lifecycle.handleWindowClose(win, event));
  win.on('closed', () => lifecycle.handleWindowClosed(win));

  // Same page for both; ?window=lock renders only the login screens.
  const search = kind === 'lock' ? 'window=lock' : '';
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    void win.loadURL(search ? `${devUrl}?${search}` : devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search });
  }
  return win;
}

function windowStateOf(win: BrowserWindow | null): WindowState {
  return {
    maximized: (win?.isMaximized() || win?.isFullScreen()) ?? false,
    focused: win?.isFocused() ?? true,
  };
}

/** A window button drawn by the page, for the window that drew it. */
function windowControl(sender: Electron.WebContents, action: WindowAction): void {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'close')
    win.close(); // the same 'close' as the native button: to the tray
  else if (win.isFullScreen()) win.setFullScreen(false);
  else if (win.isMaximized()) win.unmaximize();
  else win.maximize();
}

/**
 * The native window background (seen for a frame while resizing) in the theme the page painted.
 * The page calls this (IPC app:chrome-theme) once that theme is on screen.
 */
function syncNativeChrome(theme: ResolvedTheme): void {
  if (process.platform === 'darwin' || material === 'mica') return;
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(WINDOW_BACKGROUND[theme]);
}

/** Native menus and dialogs follow the setting; the window background follows the page (above). */
function applyTheme(theme: ThemePreference): void {
  nativeTheme.themeSource = theme;
}

/**
 * Radar's icon (resources/, made by `npm run icons`): the .ico on Windows (every size, crisp in
 * the taskbar), the PNG elsewhere.
 */
function appIconPath(): string {
  return join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray.png'));
  if (icon.isEmpty()) {
    console.error('[radar] tray icon not found or unreadable; tray will have no image');
  }
  tray = new Tray(icon);
  tray.setToolTip('Radar');
  tray.setContextMenu(Menu.buildFromTemplate(lifecycle.trayMenuTemplate()));
  tray.on('click', () => lifecycle.showWindow());
}

/** Sends an event to every window (scan progress, scan finished). */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * Keeps clipboard shortcuts (and DevTools in development) but drops the default View > Reload
 * accelerator, so Ctrl/Cmd+R can mean "Scan now" as in the design.
 */
function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      ...(app.isPackaged
        ? []
        : [{ label: 'Develop', submenu: [{ role: 'toggleDevTools' as const }] }]),
    ]),
  );
}

/** The default rules (seeds/rules.json). A broken file is reported and scoring is skipped. */
function loadDefaultRules(): Rules | null {
  try {
    const raw = JSON.parse(readFileSync(join(app.getAppPath(), 'seeds', 'rules.json'), 'utf8'));
    return parseRules(raw);
  } catch (err) {
    console.error('[radar] could not load seeds/rules.json; scores are not updated:', err);
    return null;
  }
}

let defaultRules: Rules | null = null;
let compiledRules: CompiledRules | null = null;

/** Rules in use: the Rules page's version when there is a valid one, else the defaults. */
function applyRules(database: Database.Database): void {
  if (!defaultRules) return;
  const r = effectiveRules(database, defaultRules);
  if (r.error) console.error(`[radar] ${r.error}`);
  compiledRules = compileRules(r.rules);
  console.log(`[radar] scoring with ${r.custom ? 'your edited rules' : 'the default rules'}`);
}

// Deadline reading and re-scoring run in chunks of postings with a turn of the event loop
// between them, so a large database never freezes the window. They go through one queue: a scan
// finishing while a setting changes cannot run two passes over the same rows at once.
let jobs: Promise<unknown> = Promise.resolve();
function queued<T>(job: () => Promise<T>): Promise<T> {
  const next = jobs.then(job, job);
  jobs = next.catch(() => undefined);
  return next;
}
const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Re-scores every stored (non-sample) opportunity with the current rules and settings. */
function rescore(database: Database.Database, why: string): Promise<RescoreResult | null> {
  return queued(() => rescoreJob(database, why));
}

async function rescoreJob(database: Database.Database, why: string): Promise<RescoreResult | null> {
  if (!compiledRules) return null;
  try {
    const r = await rescoreAllAsync(
      database,
      compiledRules,
      profileFromSettings(getAllSettings(database)),
      new Date(),
      nextTurn,
    );
    const v = r.byVerdict;
    console.log(
      `[radar] re-scored ${r.scored} (${why}): ${v.apply} apply, ${v.maybe} maybe, ${v.needs_review} needs review, ${v.skip} skip`,
    );
    return r;
  } catch (err) {
    console.error(`[radar] re-scoring failed (${why}):`, err);
    throw err;
  }
}

/** Re-scoring triggered by data changes: logged, never fatal. */
function rescoreQuietly(database: Database.Database, why: string): Promise<void> {
  return rescore(database, why).then(
    () => undefined,
    () => undefined, // already logged
  );
}

/** Loads seeds/sources.json into the database. A broken file is reported, never fatal. */
function syncSeeds(database: Database.Database): void {
  try {
    const raw = JSON.parse(readFileSync(join(app.getAppPath(), 'seeds', 'sources.json'), 'utf8'));
    const r = syncSeedSources(database, parseSeedSources(raw), new Date());
    console.log(`[radar] sources synced from seeds: ${r.inserted} new, ${r.updated} updated`);
  } catch (err) {
    console.error('[radar] could not sync seeds/sources.json:', err);
  }
}

/** Loads seeds/programs.json (the Programs watchlist). A broken file is reported, never fatal. */
function syncPrograms(database: Database.Database): void {
  try {
    const raw = JSON.parse(readFileSync(join(app.getAppPath(), 'seeds', 'programs.json'), 'utf8'));
    const r = syncSeedPrograms(
      database,
      parseSeedPrograms(raw),
      getSetting(database, 'timezone'),
      new Date(),
    );
    console.log(
      `[radar] programs synced from seeds: ${r.inserted} new, ${r.updated} updated, ${r.watched} pages watched`,
    );
  } catch (err) {
    console.error('[radar] could not sync seeds/programs.json:', err);
  }
}

/** Reads posting deadlines from their text (confirmed, rolling or unknown). */
function refreshDeadlines(database: Database.Database, why: string): Promise<void> {
  return queued(async () => {
    try {
      const r = await extractDeadlinesAsync(database, getSetting(database, 'timezone'), nextTurn);
      console.log(
        `[radar] deadlines read (${why}): ${r.confirmed} confirmed, ${r.rolling} rolling, ${r.doubtful} to check, of ${r.checked}`,
      );
    } catch (err) {
      console.error(`[radar] reading deadlines failed (${why}):`, err);
    }
  });
}

/** Native notification; clicking it brings the window forward. */
function showNotice(notice: Notice): void {
  if (!Notification.isSupported()) {
    console.warn(`[radar] notifications unsupported; not shown: ${notice.title}`);
    return;
  }
  const n = new Notification({ title: notice.title, body: notice.body });
  liveNotifications.add(n);
  n.on('click', () => {
    lifecycle.showWindow();
    liveNotifications.delete(n);
  });
  n.on('close', () => liveNotifications.delete(n));
  n.show();
}

/** Tells the page to open these matches, once it is loaded (a window can be created first). */
function openMatches(alert: MatchAlert): void {
  const win = lifecycle.showWindow();
  const send = () => broadcast(IPC_EVENTS.matchAlert, { ...alert, open: true });
  if (win.webContents.isLoading())
    win.webContents.once('did-finish-load', () => setTimeout(send, 300));
  else send();
}

/**
 * New-match alerts that are due (after scans and on every scheduler tick). A focused window gets a
 * toast; otherwise a native notification, which opens the matches when clicked.
 */
function deliverMatchAlerts(database: Database.Database): { deferred: number } {
  try {
    const r = dueMatchAlerts(database, new Date());
    if (r.alert) {
      const alert = r.alert;
      console.log(`[radar] match alert: ${alert.title}`);
      const focused = BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.isFocused());
      if (focused) broadcast(IPC_EVENTS.matchAlert, { ...alert, open: false });
      else if (!Notification.isSupported()) {
        console.warn(`[radar] notifications unsupported; not shown: ${alert.title}`);
      } else {
        const n = new Notification({ title: alert.title, body: alert.body });
        liveNotifications.add(n);
        n.on('click', () => {
          openMatches(alert);
          liveNotifications.delete(n);
        });
        n.on('close', () => liveNotifications.delete(n));
        n.show();
      }
    }
    return { deferred: r.deferred };
  } catch (err) {
    console.error('[radar] match alerts failed:', err);
    return { deferred: 0 };
  }
}

/** Backups go here until a folder is chosen in Settings. */
function defaultBackupFolder(): string {
  return join(app.getPath('userData'), 'Backups');
}

/** The daily backup, made by the scheduler when today's is missing. */
async function dailyBackup(database: Database.Database): Promise<void> {
  const folder = getSetting(database, 'backupFolder') ?? defaultBackupFolder();
  const timeZone = getSetting(database, 'timezone');
  const now = new Date();
  if (hasBackupFor(folder, now, timeZone)) return;
  const r = await backupDatabase(database, folder, now, timeZone);
  console.log(
    `[radar] backup written: ${r.file}${r.pruned.length ? ` (removed ${r.pruned.length} old)` : ''}`,
  );
}

function fail(title: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[radar] ${title}:`, err);
  dialog.showErrorBox(title, message);
  app.exit(1);
}

/** Everything that needs the open database; null while locked. */
interface Session {
  database: Database.Database;
  scan: ScanService;
  scheduler: Scheduler;
  sync: SyncService | null;
  unregisterIpc: () => void;
}
let session: Session | null = null;
let vault: Vault | null = null;
/** The account's encrypted store (null: accounts off). */
let accountRemote: AccountRemote | null = null;

/** Re-plans reminders after pipeline rows, deadlines or programs changed. */
function remindersChanged(database: Database.Database): void {
  try {
    syncReminders(database, new Date(), getSetting(database, 'timezone'));
  } catch (err) {
    console.error('[radar] planning follow-ups failed:', err);
  }
}

/** A setting changed (here or on another device): what depends on it follows. */
function settingChanged(database: Database.Database, key: string): void {
  if (key === 'timezone') {
    // Local calendar days moved: expected program dates and parsed deadlines follow.
    syncPrograms(database);
    void refreshDeadlines(database, 'setting timezone');
    void rescoreQuietly(database, 'setting timezone');
  } else if ((SCORING_SETTING_KEYS as readonly string[]).includes(key)) {
    void rescoreQuietly(database, `setting ${key}`);
  }
}

/** Rows from another device were written: refresh what depends on them, then the pages. */
function syncApplied(database: Database.Database, r: SyncResult): void {
  if (r.changed.has('pipeline') || r.changed.has('manual') || r.changed.has('program')) {
    remindersChanged(database);
  }
  if (r.changed.has('rules')) {
    void queued(() => {
      applyRules(database);
      return rescoreJob(database, 'rules synced');
    }).catch(() => undefined); // logged by rescoreJob
  }
  for (const key of r.settings) settingChanged(database, key);
  broadcast(IPC_EVENTS.syncApplied, null);
}

/**
 * Unlocked part of the app: encrypts a plain database left from before (or finishes an
 * interrupted encryption), opens it with the data key, then starts what reads it: seeds, rules,
 * scoring, scans, the scheduler and the data IPC handlers.
 */
async function startUnlocked(dataKey: Buffer): Promise<void> {
  const dataDir = app.getPath('userData');
  const dbPath = resolveDbPath(dataDir);
  const prepared = await prepareEncryptedDatabase(dataDir, dataKey);
  if (prepared.encrypted) console.log(`[radar] ${dbPath} is now encrypted; plain file deleted`);
  if (prepared.cleanedUp) console.log('[radar] removed a plain copy left by an interrupted run');
  const database = openDatabase(dbPath, dataKey);
  let unregisterIpc: (() => void) | null = null;
  let syncService: SyncService | null = null;
  try {
    const result = migrate(database);
    const seeded = seedDefaultSettings(database);
    console.log(
      `[radar] database ${dbPath} (encrypted) at schema v${result.to}` +
        (result.applied.length ? ` (applied ${result.applied.join(', ')})` : '') +
        (seeded.length ? `; seeded settings: ${seeded.join(', ')}` : ''),
    );
    nativeTheme.themeSource = getSetting(database, 'theme');
    syncSeeds(database);
    syncPrograms(database);
    // Every device inserts the same defaults: not a change to sync.
    quietly(database, () => ensureDefaultTemplates(database, new Date()));
    defaultRules = loadDefaultRules();
    applyRules(database);
    // Queued, not awaited: the window opens while stored rows are refreshed.
    void refreshDeadlines(database, 'startup');
    void rescoreQuietly(database, 'startup');
    const http = createHttpClient();
    const scan = createScanService({
      db: database,
      http,
      onProgress: (p) => broadcast(IPC_EVENTS.scanProgress, p),
      afterScan: async () => {
        // Pipeline rows synced from another device link to postings this scan found.
        quietly(database, () => relinkPipeline(database));
        await refreshDeadlines(database, 'after scan');
        await rescoreQuietly(database, 'after scan');
      },
      onFinished: (summary) => {
        broadcast(IPC_EVENTS.scanFinished, summary);
        deliverMatchAlerts(database);
      },
    });
    if (!SHOT_MODE) applyAutostart(app, getSetting(database, 'autostart'));
    const scheduler = createScheduler({
      db: database,
      scan: { run: (trigger) => scan.run(trigger), status: () => scan.status() },
      watchPages: async () => {
        await watchPages(database, { http, now: new Date() });
      },
      dailyBackup: () => dailyBackup(database),
      notify: showNotice,
      deliverMatches: () => deliverMatchAlerts(database),
    });
    const v = vault;
    syncService =
      accountRemote && v && !SHOT_MODE
        ? createSyncService({
            db: database,
            remote: accountRemote,
            linked: () => v.account() !== null,
            recoveryInfo: () => v.recoveryInfo(),
            dataKey,
            adoptRecoveryKey: (recoveryKey) => v.adoptRecoveryKey(recoveryKey),
            onApplied: (r) => syncApplied(database, r),
            onStatus: (s) => broadcast(IPC_EVENTS.syncChanged, s),
          })
        : null;
    unregisterIpc = registerIpcHandlers({
      ipcMain,
      db: database,
      applyAutostart: (enabled) => applyAutostart(app, enabled),
      applyTheme,
      windowInfo,
      openExternal: (url) => shell.openExternal(url),
      copyText: (text) => clipboard.writeText(text),
      openMailto: (url) => {
        if (!url.startsWith('mailto:')) throw new Error('Not a mail link');
        return shell.openExternal(url);
      },
      // Dev only: the fixture lives in the repo, next to package.json.
      readSampleFixture: () =>
        JSON.parse(
          readFileSync(join(app.getAppPath(), 'fixtures', 'sample-opportunities.json'), 'utf8'),
        ) as unknown,
      scan,
      isTrustedSender: isAppUrl,
      pickCsvFile: async () => {
        const win = BrowserWindow.getFocusedWindow();
        const options = {
          title: 'Import pipeline from CSV',
          filters: [{ name: 'CSV', extensions: ['csv'] }],
          properties: ['openFile' as const],
        };
        const r = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
      readTextFile: (path) => readFileSync(path, 'utf8'),
      testSource: (source) => testFetch(source, http),
      defaultRules: () => defaultRules,
      rulesChanged: () =>
        queued(() => {
          applyRules(database);
          return rescoreJob(database, 'rules changed');
        }),
      rescoreNow: () => rescore(database, 'Re-score everything'),
      checkProgramPage: async (programId) => {
        const row = database
          .prepare('SELECT source_id FROM programs WHERE id = ?')
          .get(programId) as { source_id: number | null } | undefined;
        const source = row?.source_id ? getSource(database, row.source_id) : undefined;
        if (!source?.url || !source.enabled) throw new Error('This program has no page to watch');
        if (source.paused) throw new Error('Its page is paused on the Sources page');
        const at = new Date();
        const r = await checkPage(database, source, { http, now: at, force: true });
        // The user is looking at the result: no desktop notification for this alert.
        if (r.outcome === 'changed') {
          database
            .prepare('UPDATE alerts SET notified_at = ? WHERE id = ?')
            .run(at.toISOString(), r.alertId);
        }
        return r;
      },
      saveTextFile: async (suggestedName, contents, filter) => {
        const win = BrowserWindow.getFocusedWindow();
        const options = {
          title: `Save ${filter.name}`,
          defaultPath: join(app.getPath('downloads'), suggestedName),
          filters: [filter],
        };
        const r = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options);
        if (r.canceled || !r.filePath) return null;
        writeFileSync(r.filePath, contents, 'utf8');
        return r.filePath;
      },
      defaultBackupFolder: () => defaultBackupFolder(),
      chooseFolder: async (title, defaultPath) => {
        const win = BrowserWindow.getFocusedWindow();
        const options = {
          title,
          defaultPath,
          properties: ['openDirectory' as const, 'createDirectory' as const],
        };
        const r = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
      openFolder: async (path) => {
        const error = await shell.openPath(path);
        if (error) throw new Error(error);
      },
      onRemindersChanged: () => remindersChanged(database),
      onSettingChanged: (key) => settingChanged(database, key),
      sync: syncService,
    });
    session = { database, scan, scheduler, sync: syncService, unregisterIpc };
  } catch (err) {
    unregisterIpc?.();
    await syncService?.stop();
    await jobs; // startup re-scoring may already be queued on this database
    database.close();
    throw err;
  }
  // Hourly tick and now (startup catch-up); wake from sleep ticks too (see startShell).
  if (!SHOT_MODE) session.scheduler.start();
  session.sync?.start();
}

/** Lock: data IPC goes first, then background work drains, then the database closes. */
async function stopUnlocked(): Promise<void> {
  const s = session;
  if (!s) return;
  session = null;
  s.unregisterIpc();
  await s.sync?.stop();
  await s.scheduler.stop();
  await s.scan.stop();
  await jobs;
  s.database.close();
  compiledRules = null;
  console.log('[radar] locked: database closed');
}

let auth: Auth | null = null;
let lastAuthState: AuthStatus['state'] | null = null;

/**
 * The Supabase account service and encrypted store from .env (MAIN_VITE_SUPABASE_URL / _KEY), or
 * why there is none. Screenshots run without accounts. Tokens are kept by main, encrypted with
 * safeStorage.
 */
function accountService(): { account: AccountService; remote: AccountRemote } | string | null {
  if (SHOT_MODE) return null;
  const url = import.meta.env.MAIN_VITE_SUPABASE_URL;
  const key = import.meta.env.MAIN_VITE_SUPABASE_KEY;
  if (!url || !key) {
    return 'Radar needs its account settings: copy .env.example to .env and fill in the Supabase URL and key.';
  }
  const storage = createSessionStore(join(app.getPath('userData'), 'session.bin'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  });
  const config = { url, key, storage, redirectTo: CALLBACK_URL };
  const client = createSupabaseClient(config);
  return { account: createSupabaseAccount(config, client), remote: createSupabaseRemote(client) };
}

function refreshTray(): void {
  tray?.setContextMenu(Menu.buildFromTemplate(lifecycle.trayMenuTemplate()));
}

/** The app without its data: window, tray, menu and the lock screen's IPC. */
function startShell(): void {
  // The app asks for no browser permissions (camera, geolocation, ...): refuse them all.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  electronSession.defaultSession.setPermissionCheckHandler(() => false);

  vault = createVault({
    dataDir: app.getPath('userData'),
    open: startUnlocked,
    close: stopUnlocked,
    onChange: () => auth?.notify(),
  });
  const service = accountService();
  accountRemote = service && typeof service !== 'string' ? service.remote : null;
  let syncReady = false;
  const v = createAuth({
    vault,
    account: service && typeof service !== 'string' ? service.account : null,
    remote: accountRemote,
    unavailable: typeof service === 'string' ? service : undefined,
    startCallbackServer: (onResult) => startCallbackServer(onResult),
    openExternal: (url) => shell.openExternal(url),
    onChange: (status) => {
      refreshTray();
      broadcast(IPC_EVENTS.authChanged, status);
      lifecycle.syncWindowKind();
      // A browser sign-in or email link finished: bring Radar back in front of the browser.
      const waited = lastAuthState === 'browser' || lastAuthState === 'check-email';
      if (waited && status.state !== lastAuthState) lifecycle.showWindow();
      lastAuthState = status.state;
      // Signed in and in the app: sync now rather than at the next minute.
      const ready =
        status.state === 'unlocked' && !status.recoveryKey && status.session === 'online';
      if (ready && !syncReady) void session?.sync?.now();
      syncReady = ready;
    },
  });
  auth = v;
  registerShellHandlers({
    ipcMain,
    windowInfo,
    setChromeTheme: syncNativeChrome,
    windowControl,
    windowState: (sender) => windowStateOf(BrowserWindow.fromWebContents(sender)),
    auth: v,
    isTrustedSender: isAppUrl,
  });

  installMenu();
  // Unpackaged runs show Electron's icon in the Dock; packaged builds use icon.icns.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(join(__dirname, '../../resources/icon.png'));
  }
  console.log(`[radar] window material: ${material}`);

  if (SHOT_MODE) {
    // Throwaway profile: a random password nobody needs, so the screens show real pages.
    void v
      .setup(randomBytes(24).toString('base64'))
      .then(() => v.confirmRecoveryKey())
      .then(() => {
        const win = lifecycle.showWindow();
        return import('./shot').then(({ runShots }) => runShots(win as BrowserWindow));
      })
      .then(
        () => lifecycle.quit(),
        (err) => fail('Screenshot run failed', err),
      );
    return;
  }

  const status = v.status();
  if (status.state === 'error') console.error(`[radar] cannot open the data: ${status.message}`);
  createTray();
  lifecycle.showWindow();
  app.on('activate', () => lifecycle.showWindow());
  powerMonitor.on('resume', () => {
    void session?.scheduler.tick('resume');
    void session?.sync?.now();
  });
}

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the DB and tray; it is told to show its window via 'second-instance'.
  app.quit();
} else {
  app.on('second-instance', () => lifecycle.showWindow());
  app.whenReady().then(startShell, (err) => fail('Radar failed to start', err));

  // Stay alive in the tray when no window is open.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => lifecycle.handleBeforeQuit());
  app.on('will-quit', () => {
    void auth?.dispose();
    void session?.scheduler.stop();
    tray?.destroy();
    session?.database.close();
  });
}
