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

/** Alpha of the black dialog scrim, --dim in tokens.css (a test checks). */
export const SCRIM_ALPHA: Record<ResolvedTheme, number> = { light: 0.16, dark: 0.42 };

/** A #RRGGBB color as it looks under a black layer of this opacity. */
export function underScrim(hex: string, alpha: number): string {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${channels
    .map((c) =>
      Math.round(c * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/**
 * Overlay colors for a theme. While a dialog dims the page, the native controls are dimmed the
 * same way: the page's scrim cannot cover them.
 */
export function titleBarOverlay(
  theme: ResolvedTheme,
  dimmed = false,
): { color: string; symbolColor: string } {
  const base = TITLE_BAR_OVERLAY[theme];
  if (!dimmed) return base;
  const a = SCRIM_ALPHA[theme];
  return { color: underScrim(base.color, a), symbolColor: underScrim(base.symbolColor, a) };
}

/** Toolbar height in px (design: 52). The native controls overlay is 1 px shorter. */
export const TOOLBAR_HEIGHT = 52;

/** The login window's native controls overlay height in px (--lock-titlebar-height). */
export const LOCK_TITLEBAR_HEIGHT = 40;
