import { useEffect, useLayoutEffect, useState } from 'react';
import { resolveTheme, type ResolvedTheme, type ThemePreference } from '../../../shared/theme';

const QUERY = '(prefers-color-scheme: dark)';

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
  // Layout effect: the new tokens apply before the next paint, in the same frame as the components
  // that re-render for the new theme (the toolbar icon, the score rings).
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.dataset['theme'] === resolved) return;
    switchWithoutTransitions(root, () => {
      root.dataset['theme'] = resolved;
    });
  }, [resolved]);
  return resolved;
}
