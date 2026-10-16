// Quiet hours (Settings): notifications are deferred, never dropped, while the local time is
// inside the window. A window whose start is after its end wraps midnight (22:00-08:00).
import type { Settings } from '../settings/schema';
import { addLocalDays, zonedParts, zonedToUtc } from '../time';

type QuietHours = Settings['quietHours'];

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

export function isQuietTime(now: Date, quiet: QuietHours, timeZone: string): boolean {
  if (!quiet.enabled) return false;
  const p = zonedParts(now, timeZone);
  const t = p.hour * 60 + p.minute;
  const start = minutes(quiet.start);
  const end = minutes(quiet.end);
  if (start === end) return false;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/** When the current quiet period ends (UTC), or null when it is not quiet now. */
export function quietEndsAt(now: Date, quiet: QuietHours, timeZone: string): Date | null {
  if (!isQuietTime(now, quiet, timeZone)) return null;
  const end = minutes(quiet.end);
  const p = zonedParts(now, timeZone);
  const today = p.hour * 60 + p.minute < end;
  const day = addLocalDays(now, today ? 0 : 1, timeZone);
  return zonedToUtc(day.year, day.month, day.day, Math.floor(end / 60), end % 60, 0, 0, timeZone);
}
