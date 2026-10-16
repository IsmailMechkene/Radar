import { describe, expect, it } from 'vitest';
import { clampScore, ringTone } from '../src/renderer/components/lib/ring';
import { cn } from '../src/renderer/components/lib/cn';
import {
  canGoBack,
  canGoForward,
  currentRoute,
  navInit,
  navReducer,
  parseRoute,
} from '../src/renderer/src/lib/router';
import {
  addListItem,
  cleanIpcError,
  isHhmm,
  removeListItem,
  scanIntervalLabel,
  scanIntervalOptions,
  shortcutLabel,
  timezoneLabel,
  timezoneList,
} from '../src/renderer/src/lib/settings-helpers';

describe('score ring', () => {
  it('colors by the design thresholds', () => {
    expect(ringTone(92)).toBe('green');
    expect(ringTone(75)).toBe('green');
    expect(ringTone(74)).toBe('amber');
    expect(ringTone(55)).toBe('amber');
    expect(ringTone(54)).toBe('gray');
  });

  it('clamps and rounds', () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(64.6)).toBe(65);
    expect(clampScore(Number.NaN)).toBe(0);
  });
});

describe('router', () => {
  it('parses hashes and falls back to the default', () => {
    expect(parseRoute('#/settings', false)).toBe('settings');
    expect(parseRoute('#/SETTINGS?x=1', false)).toBe('settings');
    expect(parseRoute('', false)).toBe('opportunities');
    expect(parseRoute('#/nope', false)).toBe('opportunities');
  });

  it('hides dev routes unless allowed', () => {
    expect(parseRoute('#/components', false)).toBe('opportunities');
    expect(parseRoute('#/components', true)).toBe('components');
  });

  it('keeps a back/forward history', () => {
    let s = navInit('opportunities');
    expect(canGoBack(s)).toBe(false);
    s = navReducer(s, { type: 'go', route: 'settings' });
    s = navReducer(s, { type: 'go', route: 'rules' });
    expect(currentRoute(s)).toBe('rules');
    s = navReducer(s, { type: 'back' });
    expect(currentRoute(s)).toBe('settings');
    expect(canGoForward(s)).toBe(true);
    s = navReducer(s, { type: 'go', route: 'sources' });
    expect(canGoForward(s)).toBe(false);
    expect(s.stack).toEqual(['opportunities', 'settings', 'sources']);
    expect(navReducer(s, { type: 'go', route: 'sources' })).toBe(s);
  });
});

describe('settings helpers', () => {
  it('labels a time zone with its offset at a given instant', () => {
    const winter = new Date('2027-01-15T12:00:00Z');
    const summer = new Date('2027-07-15T12:00:00Z');
    expect(timezoneLabel('Africa/Tunis', winter)).toBe('Africa/Tunis (GMT+1)');
    expect(timezoneLabel('Europe/Paris', winter)).toBe('Europe/Paris (GMT+1)');
    expect(timezoneLabel('Europe/Paris', summer)).toBe('Europe/Paris (GMT+2)');
  });

  it('lists zones and always includes the stored one', () => {
    expect(timezoneList('Africa/Tunis')).toContain('Africa/Tunis');
    expect(timezoneList('Etc/GMT+3')[0]).toBe('Etc/GMT+3');
  });

  it('adds trimmed, de-duplicated list items', () => {
    expect(addListItem(['Backend'], '  Data  ')).toEqual(['Backend', 'Data']);
    expect(addListItem(['Backend'], 'backend')).toEqual(['Backend']);
    expect(addListItem(['Backend'], '   ')).toEqual(['Backend']);
    expect(removeListItem(['A', 'B'], 'A')).toEqual(['B']);
  });

  it('validates 24-hour times', () => {
    expect(isHhmm('22:00')).toBe(true);
    expect(isHhmm('08:30')).toBe(true);
    expect(isHhmm('8:30')).toBe(false);
    expect(isHhmm('24:00')).toBe(false);
  });

  it('turns IPC errors into short messages', () => {
    expect(
      cleanIpcError(
        new Error(
          "Error invoking remote method 'settings:set': Error: settings:set failed: ✖ Too small: expected number to be >=1",
        ),
      ),
    ).toBe('Too small: expected number to be >=1');
    expect(
      cleanIpcError(
        "Error invoking remote method 'settings:set': Error: settings:set: invalid payload\n✖ Invalid option\n  → at key",
      ),
    ).toBe('Invalid option');
    expect(cleanIpcError(new Error('disk full'))).toBe('disk full');
  });

  it('builds scan interval options including a custom stored value', () => {
    expect(scanIntervalOptions(6)).toEqual([1, 2, 3, 6, 12, 24]);
    expect(scanIntervalOptions(8)).toEqual([1, 2, 3, 6, 8, 12, 24]);
    expect(scanIntervalLabel(1)).toBe('Every hour');
    expect(scanIntervalLabel(6)).toBe('Every 6 hours');
  });

  it('labels shortcuts per platform', () => {
    expect(shortcutLabel('win32', 'K')).toBe('Ctrl K');
    expect(shortcutLabel('darwin', 'K')).toBe('⌘K');
  });

  it('joins class names', () => {
    expect(cn('a', false, undefined, 'b', null, '')).toBe('a b');
  });
});
