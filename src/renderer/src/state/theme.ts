import { useEffect, useLayoutEffect, useState } from 'react';
import { onScrimChange, scrimIsOpen } from '../../components/lib/scrim';
import { resolveTheme, type ResolvedTheme, type ThemePreference } from '../../../shared/theme';

const QUERY = '(prefers-color-scheme: dark)';
const REMEMBERED = 'radar.theme';

/**
 * The theme setting as last seen, kept in this window's storage so the lock screen (which cannot
 * read settings) opens in the same theme. Not sensitive; a missing value means 'system'.
 */
export function rememberedTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(REMEMBERED);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function rememberTheme(pref: ThemePreference): void {
  try {
    localStorage.setItem(REMEMBERED, pref);
  } catch {
    // storage unavailable: the lock screen follows the OS instead
  }
}

/** Applies `change` with every CSS transition off, so the whole page switches in one frame. */
function switchWithoutTransitions(root: HTMLElement, change: () => void): void {
  root.dataset['themeSwitching'] = '';
  change();
  // Commit the new colors while transitions are off, then turn them back on.
  void getComputedStyle(root).color;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => delete root.dataset['themeSwitching']);
  });
}

function syncChrome(theme: ResolvedTheme, dimmed: boolean): void {
  window.radar.app.setChromeTheme(theme, dimmed).catch((err: unknown) => {
    console.error('[theme] window controls not updated', err);
  });
}

/** Resolves the theme (setting + OS) and writes it to <html data-theme>, which drives the tokens. */
export function useAppliedTheme(pref: ThemePreference | undefined): ResolvedTheme {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(pref ?? 'system', systemDark);
  useEffect(() => {
    if (pref) rememberTheme(pref);
  }, [pref]);
  // Layout effect: the new tokens apply before the next paint, in the same frame as the components
  // that re-render for the new theme (the toolbar icon, the score rings).
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.dataset['theme'] !== resolved) {
      switchWithoutTransitions(root, () => {
        root.dataset['theme'] = resolved;
      });
    }
    // The native window controls follow once this frame is on screen (two frames later), so
    // they never change before the page does. Also when the page already showed this theme on
    // load: the controls may still be in another one (theme changed, then the page reloaded).
    requestAnimationFrame(() => requestAnimationFrame(() => syncChrome(resolved, scrimIsOpen())));
  }, [resolved]);

  // A dialog's scrim dims the page; the native controls are dimmed with it.
  useEffect(() => onScrimChange((dimmed) => syncChrome(resolved, dimmed)), [resolved]);
  return resolved;
}
