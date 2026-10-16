import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Tray,
  type BrowserWindowConstructorOptions,
} from 'electron';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { migrate } from '../core/db/migrate';
import { openDatabase, resolveDbPath } from '../core/db/open';
import { getSetting, seedDefaultSettings } from '../core/settings/store';
import type { WindowInfo } from '../shared/ipc';
import { TITLE_BAR_OVERLAY, TOOLBAR_HEIGHT, type ThemePreference } from '../shared/theme';
import { registerIpcHandlers } from './ipc';
import { applyAutostart, createLifecycle } from './lifecycle';
import { chooseWindowMaterial } from './window-material';

// `npm run shot`: capture screenshots against a throwaway profile, never the user's data.
const SHOT_MODE = process.argv.includes('--radar-shot');
if (SHOT_MODE) app.setPath('userData', join(tmpdir(), `radar-shot-${process.pid}`));

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
    if (!SHOT_MODE) applyAutostart(app, getSetting(database, 'autostart'));
    registerIpcHandlers({
      ipcMain,
      db: database,
      applyAutostart: (enabled) => applyAutostart(app, enabled),
      applyTheme,
      windowInfo,
    });
  } catch (err) {
    fail(`Radar could not open its database (${dbPath})`, err);
    return;
  }

  nativeTheme.on('updated', syncNativeChrome);
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
    tray?.destroy();
    db?.close();
  });
}
