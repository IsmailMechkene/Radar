// Date display and calendar math in the user's time zone (settings.timezone). Stored values are
// UTC ISO strings; everything here converts for display only. Pure: pass the clock in.

const DAY_MS = 86_400_000;

function partsIn(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Whole calendar days from `from` to `to` as seen in `timeZone` (negative if `to` is earlier). */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  const a = partsIn(from, timeZone);
  const b = partsIn(to, timeZone);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

/** "Nov 12" */
export function formatShortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(
    new Date(iso),
  );
}

/** "Thu, Nov 12, 2026" */
export function formatLongDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

/** "Mon, Nov 2 · 18:40" (24-hour clock). */
export function formatVisit(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${day} · ${time}`;
}

/** "Monday" — the weekday of an instant, for "12 new since Monday". */
export function formatWeekday(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(new Date(iso));
}

/** Compact age for table cells: "now", "5h", "2d", "1w", "3mo". */
export function shortAge(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'now';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/** Sentence form: "today", "1 day ago", "2 weeks ago". */
export function longAge(iso: string, now: Date): string {
  const days = Math.floor(Math.max(0, now.getTime() - new Date(iso).getTime()) / DAY_MS);
  if (days === 0) return 'today';
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return w === 1 ? '1 week ago' : `${w} weeks ago`;
  }
  const m = Math.floor(days / 30);
  return m === 1 ? '1 month ago' : `${m} months ago`;
}

/** "just now", "14 min ago", "3 h ago", "1 day ago", "5 days ago". */
export function ago(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
