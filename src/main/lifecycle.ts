// Window-close, tray and autostart behavior, kept free of Electron runtime imports so it can be unit tested.

export interface WindowLike {
  show(): void;
  hide(): void;
  focus(): void;
  restore(): void;
  isMinimized(): boolean;
}

export interface CloseEventLike {
  preventDefault(): void;
}

export interface TrayMenuItem {
  label?: string;
  type?: 'separator';
  click?: () => void;
}

export interface LifecycleDeps<W extends WindowLike> {
  app: { quit(): void };
  createWindow: () => W;
  /** Tray "Lock", shown while Radar is unlocked. */
  lock?: { available: () => boolean; run: () => void };
}

export function createLifecycle<W extends WindowLike>(deps: LifecycleDeps<W>) {
  let quitting = false;
  let window: W | null = null;

  function showWindow(): W {
    if (!window) {
      window = deps.createWindow();
      return window;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return window;
  }

  function quit(): void {
    quitting = true;
    deps.app.quit();
  }

  return {
    showWindow,
    quit,
    isQuitting: () => quitting,
    /** Wire to the window's 'close' event: hide to tray unless the app is quitting. */
    handleWindowClose(win: WindowLike, event: CloseEventLike): void {
      if (quitting) return;
      event.preventDefault();
      win.hide();
    },
    /** Wire to the window's 'closed' event. */
    handleWindowClosed(): void {
      window = null;
    },
    /** Wire to app 'before-quit' (OS shutdown, installer, etc.) so windows are allowed to close. */
    handleBeforeQuit(): void {
      quitting = true;
    },
    trayMenuTemplate(): TrayMenuItem[] {
      const lock = deps.lock;
      return [
        { label: 'Open', click: () => void showWindow() },
        ...(lock?.available() ? [{ label: 'Lock', click: () => lock.run() }] : []),
        { type: 'separator' as const },
        { label: 'Quit', click: quit },
      ];
    },
  };
}

export type Lifecycle = ReturnType<typeof createLifecycle>;

export interface LoginItemApp {
  isPackaged: boolean;
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

/**
 * Registers or removes the OS login item. Skipped in development so the dev Electron
 * binary is never registered to start at login.
 */
export function applyAutostart(app: LoginItemApp, enabled: boolean): 'applied' | 'skipped-dev' {
  if (!app.isPackaged) {
    console.info(`[radar] autostart=${enabled} saved; login item not changed in development`);
    return 'skipped-dev';
  }
  app.setLoginItemSettings({ openAtLogin: enabled });
  return 'applied';
}
