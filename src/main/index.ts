import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  shell,
  Tray,
  type BrowserWindowConstructorOptions,
} from 'electron';
import { readFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { migrate } from '../core/db/migrate';
import { openDatabase, resolveDbPath } from '../core/db/open';
import { extractDeadlines } from '../core/deadlines/postings';
import { createHttpClient } from '../core/http/client';
import { parseSeedPrograms, syncSeedPrograms } from '../core/programs/seeds';
import type { Notice } from '../core/reminders/store';
import { compileRules, type CompiledRules } from '../core/rules/engine';
import { profileFromSettings, SCORING_SETTING_KEYS } from '../core/rules/profile';
import { rescoreAll } from '../core/rules/rescore';
import { parseRules } from '../core/rules/schema';
import { getAllSettings, getSetting, seedDefaultSettings } from '../core/settings/store';
import { parseSeedSources } from '../core/sources/seeds';
import { syncSeedSources } from '../core/sources/sync';
import { IPC_EVENTS, type WindowInfo } from '../shared/ipc';
import { TITLE_BAR_OVERLAY, TOOLBAR_HEIGHT, type ThemePreference } from '../shared/theme';
import { registerIpcHandlers } from './ipc';
import { applyAutostart, createLifecycle } from './lifecycle';
import { createScanService } from './scan';
import { createScheduler, type Scheduler } from './scheduler';
import { watchPages } from '../core/watch/pages';
import { chooseWindowMaterial } from './window-material';

// `npm run shot`: capture screenshots against a throwaway profile, never the user's data.
const SHOT_MODE = process.argv.includes('--radar-shot');
if (SHOT_MODE) app.setPath('userData', join(tmpdir(), `radar-shot-${process.pid}`));
// Development only: RADAR_USER_DATA points a second instance at its own profile (own DB and
// single-instance lock), e.g. for UI tests while your normal dev app keeps running.
else if (!app.isPackaged && process.env['RADAR_USER_DATA']) {
  app.setPath('userData', process.env['RADAR_USER_DATA']);
}

// The native controls stop 1 px short of the toolbar so its bottom hairline stays visible.
const OVERLAY_HEIGHT = TOOLBAR_HEIGHT - 1;

const material = chooseWindowMaterial(process.platform, release());
const windowInfo = (): WindowInfo => ({
  platform: process.platform,
  isPackaged: app.isPackaged,
  material,
});

let tray: Tray | null = null;
let db: Database.Database | null = null;
let scheduler: Scheduler | null = null;
// Notifications are kept referenced until closed, or their click handler can be collected.
const liveNotifications = new Set<Notification>();

const lifecycle = createLifecycle({ app, createWindow });

function overlayColors() {
  return TITLE_BAR_OVERLAY[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
}

function chromeOptions(): BrowserWindowConstructorOptions {
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
  // Windows/Linux: no native title bar; the native min/max/close controls float over the toolbar.
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...overlayColors(), height: OVERLAY_HEIGHT },
    ...(material === 'mica'
      ? { backgroundMaterial: 'mica', backgroundColor: '#00000000' }
      : { backgroundColor: overlayColors().color }),
  };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Radar',
    autoHideMenuBar: true,
    ...chromeOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Opens maximized (full work area), not at a fixed size.
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  // Links never open inside the app: new windows are denied and off-app navigation is blocked.
  // External links go through window.radar.app.openExternal (http/https only).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!(devUrl && url.startsWith(devUrl)) && !url.startsWith('file://')) event.preventDefault();
  });
  win.on('close', (event) => lifecycle.handleWindowClose(win, event));
  win.on('closed', () => lifecycle.handleWindowClosed());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

/** Keeps native chrome (controls overlay, window background) in step with the theme. */
function syncNativeChrome(): void {
  if (process.platform === 'darwin') return;
  const colors = overlayColors();
  for (const win of BrowserWindow.getAllWindows()) {
    win.setTitleBarOverlay({ ...colors, height: OVERLAY_HEIGHT });
    if (material !== 'mica') win.setBackgroundColor(colors.color);
  }
}

function applyTheme(theme: ThemePreference): void {
  nativeTheme.themeSource = theme;
  syncNativeChrome();
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

/** Loads seeds/rules.json. A broken file is reported and scoring is skipped, never fatal. */
function loadRules(): CompiledRules | null {
  try {
    const raw = JSON.parse(readFileSync(join(app.getAppPath(), 'seeds', 'rules.json'), 'utf8'));
    return compileRules(parseRules(raw));
  } catch (err) {
    console.error('[radar] could not load seeds/rules.json; scores are not updated:', err);
    return null;
  }
}

/** Re-scores every stored (non-sample) opportunity with the current rules and settings. */
function rescore(database: Database.Database, rules: CompiledRules | null, why: string): void {
  if (!rules) return;
  try {
    const r = rescoreAll(
      database,
      rules,
      profileFromSettings(getAllSettings(database)),
      new Date(),
    );
    const v = r.byVerdict;
    console.log(
      `[radar] re-scored ${r.scored} (${why}): ${v.apply} apply, ${v.maybe} maybe, ${v.needs_review} needs review, ${v.skip} skip`,
    );
  } catch (err) {
    console.error(`[radar] re-scoring failed (${why}):`, err);
  }
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
function refreshDeadlines(database: Database.Database, why: string): void {
  try {
    const r = extractDeadlines(database, getSetting(database, 'timezone'));
    console.log(
      `[radar] deadlines read (${why}): ${r.confirmed} confirmed, ${r.rolling} rolling, ${r.doubtful} to check, of ${r.checked}`,
    );
  } catch (err) {
    console.error(`[radar] reading deadlines failed (${why}):`, err);
  }
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

function fail(title: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[radar] ${title}:`, err);
  dialog.showErrorBox(title, message);
  app.exit(1);
}

function start(): void {
  const dbPath = resolveDbPath(app.getPath('userData'));
  try {
    const database = openDatabase(dbPath);
    db = database;
    const result = migrate(database);
    const seeded = seedDefaultSettings(database);
    console.log(
      `[radar] database ${dbPath} at schema v${result.to}` +
        (result.applied.length ? ` (applied ${result.applied.join(', ')})` : '') +
        (seeded.length ? `; seeded settings: ${seeded.join(', ')}` : ''),
    );
    nativeTheme.themeSource = getSetting(database, 'theme');
    syncSeeds(database);
    syncPrograms(database);
    refreshDeadlines(database, 'startup');
    const rules = loadRules();
    rescore(database, rules, 'startup');
    const http = createHttpClient();
    const scan = createScanService({
      db: database,
      http,
      onProgress: (p) => broadcast(IPC_EVENTS.scanProgress, p),
      afterScan: () => {
        refreshDeadlines(database, 'after scan');
        rescore(database, rules, 'after scan');
      },
      onFinished: (summary) => broadcast(IPC_EVENTS.scanFinished, summary),
    });
    if (!SHOT_MODE) applyAutostart(app, getSetting(database, 'autostart'));
    scheduler = createScheduler({
      db: database,
      scan: { run: (trigger) => scan.run(trigger), status: () => scan.status() },
      watchPages: async () => {
        await watchPages(database, { http, now: new Date() });
      },
      notify: showNotice,
    });
    registerIpcHandlers({
      ipcMain,
      db: database,
      applyAutostart: (enabled) => applyAutostart(app, enabled),
      applyTheme,
      windowInfo,
      openExternal: (url) => shell.openExternal(url),
      // Dev only: the fixture lives in the repo, next to package.json.
      readSampleFixture: () =>
        JSON.parse(
          readFileSync(join(app.getAppPath(), 'fixtures', 'sample-opportunities.json'), 'utf8'),
        ) as unknown,
      scan,
      onSettingChanged: (key) => {
        if (key === 'timezone') {
          // Local calendar days moved: expected program dates and parsed deadlines follow.
          syncPrograms(database);
          refreshDeadlines(database, 'setting timezone');
          rescore(database, rules, 'setting timezone');
        } else if ((SCORING_SETTING_KEYS as readonly string[]).includes(key)) {
          rescore(database, rules, `setting ${key}`);
        }
      },
    });
  } catch (err) {
    fail(`Radar could not open its database (${dbPath})`, err);
    return;
  }

  nativeTheme.on('updated', syncNativeChrome);
  installMenu();
  console.log(`[radar] window material: ${material}`);

  if (SHOT_MODE) {
    const win = lifecycle.showWindow();
    void import('./shot')
      .then(({ runShots }) => runShots(win as BrowserWindow))
      .then(
        () => lifecycle.quit(),
        (err) => fail('Screenshot run failed', err),
      );
    return;
  }

  createTray();
  lifecycle.showWindow();
  app.on('activate', () => lifecycle.showWindow());
  // Hourly tick, now (startup catch-up), and after the computer wakes up.
  scheduler?.start();
  powerMonitor.on('resume', () => void scheduler?.tick('resume'));
}

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the DB and tray; it is told to show its window via 'second-instance'.
  app.quit();
} else {
  app.on('second-instance', () => lifecycle.showWindow());
  app.whenReady().then(start, (err) => fail('Radar failed to start', err));

  // Stay alive in the tray when no window is open.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => lifecycle.handleBeforeQuit());
  app.on('will-quit', () => {
    scheduler?.stop();
    tray?.destroy();
    db?.close();
  });
}
