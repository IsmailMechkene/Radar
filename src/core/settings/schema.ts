import { z } from 'zod';

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (24h)');

export const settingsSchema = z.strictObject({
  timezone: z.string().refine(isValidTimeZone, 'unknown IANA time zone'),
  searchMode: z.enum(['internships', 'all']),
  rolesOfInterest: z.array(z.string().trim().min(1)).min(1),
  targetRegions: z.array(z.string().trim().min(1)),
  remotePreference: z.enum([
    'onsite_preferred',
    'remote_preferred',
    'onsite_only',
    'remote_only',
    'any',
  ]),
  // Raw grade text as the user wrote it; never converted to another scale.
  grade: z.strictObject({ raw: z.string().trim().min(1), unverified: z.boolean() }),
  quietHours: z.strictObject({ enabled: z.boolean(), start: hhmm, end: hhmm }),
  autostart: z.boolean(),
  scanIntervalHours: z.int().min(1).max(168),
  // Appearance. 'system' follows the OS light/dark setting.
  theme: z.enum(['system', 'light', 'dark']),
});

export type Settings = z.output<typeof settingsSchema>;
export const settingKeySchema = settingsSchema.keyof();
export type SettingKey = z.output<typeof settingKeySchema>;

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'Africa/Tunis',
  searchMode: 'internships',
  rolesOfInterest: [
    'AI/ML engineer',
    'Backend engineer',
    'Full-stack engineer',
    'Software engineer intern',
  ],
  targetRegions: ['Europe', 'Middle East', 'North America', 'Remote'],
  remotePreference: 'onsite_preferred',
  grade: { raw: '15/20', unverified: true },
  quietHours: { enabled: true, start: '22:00', end: '08:00' },
  autostart: false,
  scanIntervalHours: 6,
  theme: 'system',
};
