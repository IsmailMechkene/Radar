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
 * The native window background behind the page (seen for a frame while resizing). The only token
 * value main needs, so it is duplicated here; it must equal --bg in tokens.css (a test checks).
 */
export const WINDOW_BACKGROUND: Record<ResolvedTheme, string> = {
  light: '#F5F5F7',
  dark: '#1C1C1E',
};

/** Window buttons drawn by the page (Windows, Linux); macOS keeps its native traffic lights. */
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close';

/** What the window buttons show: restore instead of maximize, dimmed glyphs when inactive. */
export interface WindowState {
  maximized: boolean;
  focused: boolean;
}
