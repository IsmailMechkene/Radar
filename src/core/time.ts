// Wall-clock helpers for an IANA time zone, built on Intl (no dependency). Everything stored is
// UTC; these convert between a UTC instant and the user's local calendar day and time.

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The local calendar date and time of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts['year']!,
    month: parts['month']!,
    day: parts['day']!,
    hour: parts['hour']!,
    minute: parts['minute']!,
    second: parts['second']!,
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant at which the local wall clock in `timeZone` shows the given time. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let guess = wall;
  // Two passes settle the offset, DST transitions included.
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetMs(new Date(guess), timeZone);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** Start (00:00:00.000) of a local calendar day, as UTC. */
export function startOfLocalDay(year: number, month: number, day: number, tz: string): Date {
  return zonedToUtc(year, month, day, 0, 0, 0, 0, tz);
}

/** End (23:59:59.999) of a local calendar day, as UTC. */
export function endOfLocalDay(year: number, month: number, day: number, tz: string): Date {
  return zonedToUtc(year, month, day, 23, 59, 59, 999, tz);
}

/** The local calendar day of `date`, shifted by `days` (negative goes back). */
export function addLocalDays(
  date: Date,
  days: number,
  tz: string,
): { year: number; month: number; day: number } {
  const p = zonedParts(date, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Whole local calendar days from `from` to `to` (0 = same local day). */
export function localDaysBetween(from: Date, to: Date, tz: string): number {
  const a = zonedParts(from, tz);
  const b = zonedParts(to, tz);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
