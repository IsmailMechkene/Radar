import { useEffect, useState, type ReactNode } from 'react';
import type { WindowState } from '../../shared/theme';
import { cn } from './lib/cn';

/** Windows 11 caption glyphs: 10 px line art, one stroke wide. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const MINIMIZE = <path d="M0 5.5h10" />;
const MAXIMIZE = <rect x="0.5" y="0.5" width="9" height="9" rx="1" />;
const RESTORE = (
  <>
    <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
    <path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
  </>
);
const CLOSE = <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />;

function CaptionButton({
  label,
  close,
  onClick,
  children,
}: {
  label: string;
  close?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      // Like native caption buttons: clickable, never in the tab order.
      tabIndex={-1}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid h-full w-(--caption-width) place-items-center',
        'transition-colors duration-(--duration-fast) ease-out',
        close
          ? 'hover:bg-caption-close hover:text-on-accent active:bg-caption-close-pressed active:text-on-accent'
          : 'hover:bg-fill active:bg-fill-2',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Minimize, maximize/restore and close, drawn by the page on Windows and Linux (macOS keeps its
 * native traffic lights). Being part of the page, they dim under dialogs, sit under blurs and
 * change theme in the same frame as everything else. They fill the height of their bar, flush
 * with the window's top-right corner; the glyphs dim while the window is inactive.
 */
export function WindowControls({ className }: { className?: string }) {
  const [platform, setPlatform] = useState<string | null>(null);
  const [state, setState] = useState<WindowState>({ maximized: false, focused: true });

  useEffect(() => {
    let live = true;
    window.radar.app.getWindowInfo().then(
      (i) => live && setPlatform(i.platform),
      (err: unknown) => console.error('[window] info unavailable', err),
    );
    window.radar.app.windowState().then(
      (s) => live && setState(s),
      (err: unknown) => console.error('[window] state unavailable', err),
    );
    const off = window.radar.app.onWindowState(setState);
    return () => {
      live = false;
      off();
    };
  }, []);

  if (!platform || platform === 'darwin') return null;
  const act = (action: 'minimize' | 'toggle-maximize' | 'close') => () => {
    window.radar.app.windowControl(action).catch((err: unknown) => {
      console.error(`[window] ${action} failed`, err);
    });
  };
  return (
    <div
      role="group"
      aria-label="Window"
      className={cn(
        'app-no-drag flex self-stretch',
        state.focused ? 'text-fg-2' : 'text-fg-3',
        className,
      )}
    >
      <CaptionButton label="Minimize" onClick={act('minimize')}>
        <Glyph>{MINIMIZE}</Glyph>
      </CaptionButton>
      <CaptionButton
        label={state.maximized ? 'Restore' : 'Maximize'}
        onClick={act('toggle-maximize')}
      >
        <Glyph>{state.maximized ? RESTORE : MAXIMIZE}</Glyph>
      </CaptionButton>
      <CaptionButton label="Close" close onClick={act('close')}>
        <Glyph>{CLOSE}</Glyph>
      </CaptionButton>
    </div>
  );
}
