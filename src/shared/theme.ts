// Theme resolution shared by main (native title bar, window material) and renderer (tokens).
import type { Settings } from '../core/settings/schema';

export type ThemePreference = Settings['theme'];
export type ResolvedTheme = 'light' | 'dark';

/** The effective theme: an explicit choice wins, 'system' follows the OS. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemPrefersDark ? 'dark' : 'light';
}

/** Next value for the toolbar theme button: flips the currently visible theme. */
export function toggledTheme(current: ResolvedTheme): ResolvedTheme {
  return current === 'dark' ? 'light' : 'dark';
}

/**
 * Native window-controls overlay colors. These are the only token values main needs, so they are
 * duplicated here; they must equal --bg and --tx2 in src/renderer/theme/tokens.css (a test checks).
 */
export const TITLE_BAR_OVERLAY: Record<ResolvedTheme, { color: string; symbolColor: string }> = {
  light: { color: '#F5F5F7', symbolColor: '#6E6E73' },
  dark: { color: '#1C1C1E', symbolColor: '#A1A1A6' },
};

/** Toolbar height in px (design: 52). The native controls overlay is 1 px shorter. */
export const TOOLBAR_HEIGHT = 52;
