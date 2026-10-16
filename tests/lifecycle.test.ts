import { describe, expect, it, vi } from 'vitest';
import { applyAutostart, createLifecycle } from '../src/main/lifecycle';

function fakeWindow() {
  return {
    show: vi.fn<() => void>(),
    hide: vi.fn<() => void>(),
    focus: vi.fn<() => void>(),
    restore: vi.fn<() => void>(),
    isMinimized: vi.fn<() => boolean>(() => false),
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
