// Window-close, tray and autostart behavior, kept free of Electron runtime imports so it can be unit tested.

export interface WindowLike {
  show(): void;
  hide(): void;
  focus(): void;
  restore(): void;
  isMinimized(): boolean;
  isVisible(): boolean;
  destroy(): void;
}

/** The small login window while locked; the full app window once unlocked. */
export type WindowKind = 'lock' | 'app';

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
  /** `onShown` runs once the new window is on screen (used to close the one it replaces). */
  createWindow: (kind: WindowKind, onShown?: () => void) => W;
  /** Which window the app should show now; default 'app'. */
  windowKind?: () => WindowKind;
  /** Tray "Lock", shown while Radar is unlocked. */
  lock?: { available: () => boolean; run: () => void };
}

export function createLifecycle<W extends WindowLike>(deps: LifecycleDeps<W>) {
  let quitting = false;
  let window: W | null = null;
  let kind: WindowKind = 'app';
  const wanted = () => deps.windowKind?.() ?? 'app';

  /**
   * After a lock or unlock: swaps to the window the state calls for. A visible window is replaced
   * once the new one is on screen (no gap); a hidden one (in the tray) is just closed, and the
   * right one is created when the user opens Radar again.
   */
  function syncWindowKind(): void {
    if (!window || kind === wanted()) return;
    const old = window;
    window = null;
    if (!old.isVisible()) {
      old.destroy();
      return;
    }
    kind = wanted();
    window = deps.createWindow(kind, () => old.destroy());
  }

  function showWindow(): W {
    if (window && kind !== wanted()) {
      window.destroy();
      window = null;
    }
    if (!window) {
      kind = wanted();
      window = deps.createWindow(kind);
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
    syncWindowKind,
    /** The window shown now, and what it is. */
    current: () => (window ? { window, kind } : null),
    quit,
    isQuitting: () => quitting,
    /** Wire to the window's 'close' event: hide to tray unless the app is quitting. */
    handleWindowClose(win: WindowLike, event: CloseEventLike): void {
      if (quitting) return;
      event.preventDefault();
      win.hide();
    },
    /** Wire to the window's 'closed' event (a replaced window closing does not count). */
    handleWindowClosed(win?: WindowLike): void {
      if (!win || win === window) window = null;
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
