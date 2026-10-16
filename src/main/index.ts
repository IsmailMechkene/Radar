import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { migrate } from '../core/db/migrate';
import { openDatabase, resolveDbPath } from '../core/db/open';
import { getSetting, seedDefaultSettings } from '../core/settings/store';
import { registerIpcHandlers } from './ipc';
import { applyAutostart, createLifecycle } from './lifecycle';

let tray: Tray | null = null;
let db: Database.Database | null = null;

const lifecycle = createLifecycle({ app, createWindow });

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'Radar',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());
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
    applyAutostart(app, getSetting(database, 'autostart'));
    registerIpcHandlers({
      ipcMain,
      db: database,
      applyAutostart: (enabled) => applyAutostart(app, enabled),
    });
  } catch (err) {
    fail(`Radar could not open its database (${dbPath})`, err);
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
