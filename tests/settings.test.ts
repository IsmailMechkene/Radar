import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { migrate } from '../src/core/db/migrate';
import { DEFAULT_SETTINGS, settingKeySchema } from '../src/core/settings/schema';
import {
  getAllSettings,
  getSetting,
  seedDefaultSettings,
  setSetting,
} from '../src/core/settings/store';
import { tempDb } from './helpers';

describe('settings store', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  it('seeds defaults once and never overwrites user values', () => {
    expect(seedDefaultSettings(t.db)).toEqual(settingKeySchema.options);
    expect(getAllSettings(t.db)).toEqual(DEFAULT_SETTINGS);

    setSetting(t.db, 'scanIntervalHours', 12);
    expect(seedDefaultSettings(t.db)).toEqual([]);
    expect(getSetting(t.db, 'scanIntervalHours')).toBe(12);
    expect(t.db.prepare('SELECT COUNT(*) FROM settings').pluck().get()).toBe(
      settingKeySchema.options.length,
    );
  });

  it('has the expected defaults', () => {
    seedDefaultSettings(t.db);
    expect(getSetting(t.db, 'timezone')).toBe('Africa/Tunis');
    expect(getSetting(t.db, 'searchMode')).toBe('internships');
    expect(getSetting(t.db, 'grade')).toEqual({ raw: '15/20', unverified: true });
    expect(getSetting(t.db, 'autostart')).toBe(false);
    expect(getSetting(t.db, 'scanIntervalHours')).toBe(6);
  });

  it('rejects invalid values with zod and leaves the stored value unchanged', () => {
    seedDefaultSettings(t.db);
    const cases: [Parameters<typeof setSetting>[1], unknown][] = [
      ['timezone', 'Mars/Olympus'],
      ['scanIntervalHours', 0],
      ['scanIntervalHours', 2.5],
      ['searchMode', 'everything'],
      ['quietHours', { enabled: true, start: '25:00', end: '08:00' }],
      ['grade', { raw: '15/20', unverified: true, gpa: 3.5 }],
      ['autostart', 'yes'],
    ];
    for (const [key, value] of cases) {
      expect(() => setSetting(t.db, key, value), `${key}=${JSON.stringify(value)}`).toThrow(
        ZodError,
      );
    }
    expect(getAllSettings(t.db)).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects unknown keys', () => {
    expect(() => setSetting(t.db, 'nope' as never, 1)).toThrow(ZodError);
  });
});
