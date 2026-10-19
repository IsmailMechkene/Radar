import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsSchema } from '../src/core/settings/schema';
import { chooseWindowMaterial } from '../src/main/window-material';
import { resolveTheme, toggledTheme, WINDOW_BACKGROUND } from '../src/shared/theme';

describe('theme resolution', () => {
  it('follows the OS when the preference is system', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
  });

  it('an explicit choice wins over the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('the toolbar toggle flips the visible theme', () => {
    expect(toggledTheme('light')).toBe('dark');
    expect(toggledTheme('dark')).toBe('light');
  });

  it('defaults to system and rejects unknown values', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(settingsSchema.shape.theme.safeParse('sepia').success).toBe(false);
  });
});

describe('the native window background stays in sync with tokens.css', () => {
  const css = readFileSync(join(__dirname, '../src/renderer/theme/tokens.css'), 'utf8');
  const block = (selector: string) => {
    const start = css.indexOf(selector);
    return css.slice(start, css.indexOf('}', start));
  };
  const token = (scope: string, name: string) =>
    new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block(scope))?.[1]?.toLowerCase();

  it.each([
    ['light', ":root,\n[data-theme='light']"],
    ['dark', ":root[data-theme='dark']"],
  ] as const)('%s', (theme, scope) => {
    expect(WINDOW_BACKGROUND[theme].toLowerCase()).toBe(token(scope, '--bg'));
  });
});

describe('window material', () => {
  it('uses Mica only on Windows 11 22H2 or newer', () => {
    expect(chooseWindowMaterial('win32', '10.0.19045')).toBe('none'); // Windows 10
    expect(chooseWindowMaterial('win32', '10.0.22000')).toBe('none'); // Windows 11 21H2
    expect(chooseWindowMaterial('win32', '10.0.22621')).toBe('mica');
    expect(chooseWindowMaterial('win32', '10.0.26100')).toBe('mica');
    expect(chooseWindowMaterial('win32', 'garbage')).toBe('none');
  });

  it('uses vibrancy on macOS and nothing on Linux', () => {
    expect(chooseWindowMaterial('darwin', '24.0.0')).toBe('vibrancy');
    expect(chooseWindowMaterial('linux', '6.8.0')).toBe('none');
  });
});
