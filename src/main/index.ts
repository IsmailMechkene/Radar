import { app, BrowserWindow, dialog, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase, resolveDbPath } from '../core/db/open';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: Database.Database | null = null;
let quitting = false;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'Radar',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Closing the window hides it; the app keeps running in the tray.
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow = win;
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray.png'));
  if (icon.isEmpty()) {
    console.error('[radar] tray icon not found or unreadable; tray will have no image');
  }
  tray = new Tray(icon);
  tray.setToolTip('Radar');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', showWindow);
}

app.whenReady().then(() => {
  const dbPath = resolveDbPath(app.getPath('userData'));
  try {
    db = openDatabase(dbPath);
    console.log(`[radar] database opened at ${dbPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[radar] failed to open database at ${dbPath}:`, err);
    dialog.showErrorBox('Radar could not open its database', `${dbPath}\n\n${message}`);
    app.exit(1);
    return;
  }

  createTray();
  createWindow();

  app.on('activate', showWindow);
});

// Stay alive in the tray when no window is open.
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  tray?.destroy();
  db?.close();
});
