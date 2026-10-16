// Pure helpers for the Settings page (unit tested; no DOM or React).
import type { Settings } from '../../../core/settings/schema';

/** "GMT+1" for a time zone at a given instant (offsets change with DST, so pass the clock). */
export function timezoneOffset(timeZone: string, at: Date): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? 'GMT';
}

/** "Africa/Tunis (GMT+1)", as in the design's Settings screen. */
export function timezoneLabel(timeZone: string, at: Date): string {
  return `${timeZone} (${timezoneOffset(timeZone, at)})`;
}

/** All IANA zones known to the runtime, always including the current value. */
export function timezoneList(current: string): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes(current) ? zones : [current, ...zones];
}

/** Adds a trimmed item unless it is empty or already present (case-insensitive). */
export function addListItem(list: readonly string[], raw: string): string[] {
  const item = raw.trim();
  if (!item) return [...list];
  if (list.some((x) => x.toLowerCase() === item.toLowerCase())) return [...list];
  return [...list, item];
}

export function removeListItem(list: readonly string[], item: string): string[] {
  return list.filter((x) => x !== item);
}

/** 24-hour "HH:MM", same rule as the settings schema. */
export function isHhmm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Turns an IPC rejection into a short sentence for a toast.
 * "Error invoking remote method 'settings:set': Error: settings:set failed: ✖ Too small: ..." ->
 * "Too small: ..."
 */
export function cleanIpcError(err: unknown): string {
  let text = err instanceof Error ? err.message : String(err);
  text = text.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '');
  text = text.replace(/^[\w:-]+ (failed|: invalid payload):?\s*/, '');
  const issue = text.split('\n').find((line) => line.trim().startsWith('✖'));
  return (issue ?? text.split('\n')[0] ?? text).replace(/^\s*✖\s*/, '').trim() || 'Unknown error';
}

export const SCAN_INTERVAL_PRESETS = [1, 2, 3, 6, 12, 24] as const;

export function scanIntervalLabel(hours: number): string {
  return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
}

/** Presets plus the stored value if it is not one of them. */
export function scanIntervalOptions(current: number): number[] {
  const set = new Set<number>([...SCAN_INTERVAL_PRESETS, current]);
  return [...set].sort((a, b) => a - b);
}

export const REMOTE_PREFERENCE_LABELS: Record<Settings['remotePreference'], string> = {
  onsite_preferred: 'On-site preferred',
  remote_preferred: 'Remote preferred',
  onsite_only: 'On-site only',
  remote_only: 'Remote only',
  any: 'No preference',
};

/** Shortcut label: "⌘K" on macOS, "Ctrl K" elsewhere. */
export function shortcutLabel(platform: string | undefined, key: string): string {
  return platform === 'darwin' ? `⌘${key}` : `Ctrl ${key}`;
}
