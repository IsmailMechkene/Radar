import { describe, expect, it, vi } from 'vitest';
import { applyAutostart, createLifecycle, type WindowKind } from '../src/main/lifecycle';

function fakeWindow() {
  return {
    show: vi.fn<() => void>(),
    hide: vi.fn<() => void>(),
    focus: vi.fn<() => void>(),
    restore: vi.fn<() => void>(),
    isMinimized: vi.fn<() => boolean>(() => false),
    isVisible: vi.fn<() => boolean>(() => true),
    destroy: vi.fn<() => void>(),
  };
}

function setup() {
  const app = { quit: vi.fn() };
  const win = fakeWindow();
  const createWindow = vi.fn(() => win);
  const lifecycle = createLifecycle({ app, createWindow });
  return { app, win, createWindow, lifecycle };
}

const closeEvent = () => ({ preventDefault: vi.fn() });
const click = (lifecycle: ReturnType<typeof setup>['lifecycle'], label: string) =>
  lifecycle
    .trayMenuTemplate()
    .find((item) => item.label === label)
    ?.click?.();

describe('lifecycle', () => {
  it('hides the window on close and keeps the app alive', () => {
    const { app, win, lifecycle } = setup();
    lifecycle.showWindow();

    const event = closeEvent();
    lifecycle.handleWindowClose(win, event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(win.hide).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('quits only from the tray Quit item, after which close is allowed', () => {
    const { app, win, lifecycle } = setup();
    lifecycle.showWindow();

    click(lifecycle, 'Open');
    expect(app.quit).not.toHaveBeenCalled();

    click(lifecycle, 'Quit');
    expect(app.quit).toHaveBeenCalledOnce();

    const event = closeEvent();
    lifecycle.handleWindowClose(win, event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('lets windows close when the OS asks the app to quit', () => {
    const { win, lifecycle } = setup();
    lifecycle.showWindow();
    lifecycle.handleBeforeQuit();
    const event = closeEvent();
    lifecycle.handleWindowClose(win, event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('tray Open reuses the hidden window, and recreates it after it was destroyed', () => {
    const { win, createWindow, lifecycle } = setup();
    lifecycle.showWindow();
    expect(createWindow).toHaveBeenCalledOnce();

    lifecycle.handleWindowClose(win, closeEvent());
    win.isMinimized.mockReturnValue(true);
    click(lifecycle, 'Open');
    expect(createWindow).toHaveBeenCalledOnce();
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();

    lifecycle.handleWindowClosed();
    click(lifecycle, 'Open');
    expect(createWindow).toHaveBeenCalledTimes(2);
  });
});

describe('login window and app window', () => {
  function swapSetup() {
    let kind: WindowKind = 'lock';
    const created: { kind: WindowKind; win: ReturnType<typeof fakeWindow>; shown?: () => void }[] =
      [];
    const lifecycle = createLifecycle({
      app: { quit: vi.fn() },
      createWindow: (k, onShown) => {
        const win = fakeWindow();
        created.push({ kind: k, win, shown: onShown });
        return win;
      },
      windowKind: () => kind,
    });
    return { lifecycle, created, setKind: (k: WindowKind) => (kind = k) };
  }

  it('opens the login window while locked, and swaps once the new window is on screen', () => {
    const { lifecycle, created, setKind } = swapSetup();
    lifecycle.showWindow();
    expect(created.map((c) => c.kind)).toEqual(['lock']);

    setKind('app'); // unlocked
    lifecycle.syncWindowKind();
    expect(created.map((c) => c.kind)).toEqual(['lock', 'app']);
    expect(created[0]!.win.destroy).not.toHaveBeenCalled(); // no gap while the app loads
    created[1]!.shown?.();
    expect(created[0]!.win.destroy).toHaveBeenCalledOnce();
    // The login window closing does not forget the app window.
    lifecycle.handleWindowClosed(created[0]!.win);
    expect(lifecycle.current()).toEqual({ window: created[1]!.win, kind: 'app' });

    lifecycle.syncWindowKind(); // same kind: nothing
    expect(created).toHaveLength(2);
  });

  it('a window hidden in the tray is closed, and the right one opens on Open', () => {
    const { lifecycle, created, setKind } = swapSetup();
    setKind('app');
    lifecycle.showWindow();
    created[0]!.win.isVisible.mockReturnValue(false);
    setKind('lock'); // locked from the tray
    lifecycle.syncWindowKind();
    expect(created[0]!.win.destroy).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
    expect(lifecycle.current()).toBeNull();
    lifecycle.showWindow();
    expect(created.map((c) => c.kind)).toEqual(['app', 'lock']);
  });
});

describe('tray Lock', () => {
  it('shows Lock only while unlocked and runs it', () => {
    let unlocked = false;
    const run = vi.fn();
    const lifecycle = createLifecycle({
      app: { quit: vi.fn() },
      createWindow: fakeWindow,
      lock: { available: () => unlocked, run },
    });
    const labels = () => lifecycle.trayMenuTemplate().map((i) => i.label ?? '-');
    expect(labels()).toEqual(['Open', '-', 'Quit']);
    unlocked = true;
    expect(labels()).toEqual(['Open', 'Lock', '-', 'Quit']);
    lifecycle
      .trayMenuTemplate()
      .find((i) => i.label === 'Lock')
      ?.click?.();
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('applyAutostart', () => {
  it('sets the login item when packaged', () => {
    const app = { isPackaged: true, setLoginItemSettings: vi.fn() };
    expect(applyAutostart(app, true)).toBe('applied');
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('never registers the dev binary at login', () => {
    const app = { isPackaged: false, setLoginItemSettings: vi.fn() };
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(applyAutostart(app, true)).toBe('skipped-dev');
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
