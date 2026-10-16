// Display rules for the Deadlines page. Pure: the clock and time zone are passed in.
import type { DeadlineEvent, DueFollowup } from '../../../core/deadlines/list';
import { zonedParts } from '../../../core/time';
import { calendarDaysBetween } from './dates';

const DAY = 86_400_000;

export const daysLeft = (iso: string, now: Date, tz: string) =>
  calendarDaysBetween(now, new Date(iso), tz);

/** Calendar dot / urgency color, as in the design legend. */
export type Urgency = 'overdue' | 'week' | 'later';
export function urgency(e: DeadlineEvent, now: Date, tz: string): Urgency {
  const d = daysLeft(e.at, now, tz);
  if (d < 0 && e.event === 'deadline') return 'overdue';
  return d <= 7 ? 'week' : 'later';
}

export interface LeftChip {
  label: string;
  tone: 'red' | 'amber' | 'neutral';
  dashed: boolean;
}

/** "In 9 days", "Today", "Tomorrow", "Overdue · 2 days"; openings say "Opens in 9 days". */
export function leftChip(e: DeadlineEvent, now: Date, tz: string): LeftChip {
  const d = daysLeft(e.at, now, tz);
  const dashed = e.status === 'expected';
  if (e.event === 'opens') {
    const label =
      d < 0
        ? `Opened ${-d} days ago`
        : d === 0
          ? 'Opens today'
          : d === 1
            ? 'Opens tomorrow'
            : `Opens in ${d} days`;
    return { label, tone: d >= 0 && d <= 14 ? 'amber' : 'neutral', dashed };
  }
  if (d < 0) return { label: `Overdue · ${-d} ${-d === 1 ? 'day' : 'days'}`, tone: 'red', dashed };
  const label = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
  return { label, tone: d <= 14 ? 'amber' : 'neutral', dashed };
}

export interface Group {
  id: 'overdue' | 'week' | 'month' | 'later';
  label: string;
  items: DeadlineEvent[];
}

/** List view groups. Deadlines that passed more than 30 days ago and windows that opened are left out. */
export function groupEvents(events: readonly DeadlineEvent[], now: Date, tz: string): Group[] {
  const groups: Group[] = [
    { id: 'overdue', label: 'Overdue', items: [] },
    { id: 'week', label: 'This week', items: [] },
    { id: 'month', label: 'Next 30 days', items: [] },
    { id: 'later', label: 'Later', items: [] },
  ];
  for (const e of events) {
    const d = daysLeft(e.at, now, tz);
    if (d < 0) {
      if (e.event === 'deadline' && d >= -30 && !e.done) groups[0]!.items.push(e);
    } else if (d <= 7) groups[1]!.items.push(e);
    else if (d <= 30) groups[2]!.items.push(e);
    else groups[3]!.items.push(e);
  }
  return groups.filter((g) => g.items.length > 0);
}

export type DueItem =
  | { kind: 'event'; key: string; at: string; event: DeadlineEvent }
  | { kind: 'followup'; key: string; at: string; followup: DueFollowup };

/**
 * "Due soon" (next 14 days): tracked deadlines and openings not done or snoozed, overdue ones
 * from the last week, and follow-ups that are due.
 */
export function dueSoon(
  events: readonly DeadlineEvent[],
  followups: readonly DueFollowup[],
  now: Date,
  tz: string,
): DueItem[] {
  const items: DueItem[] = [];
  for (const e of events) {
    if (!e.tracked || e.done) continue;
    if (e.snoozed_until && new Date(e.snoozed_until).getTime() > now.getTime()) continue;
    const d = daysLeft(e.at, now, tz);
    const inWindow = e.event === 'deadline' ? d >= -7 && d <= 14 : d >= 0 && d <= 14;
    if (inWindow) items.push({ kind: 'event', key: e.key, at: e.at, event: e });
  }
  for (const f of followups)
    items.push({ kind: 'followup', key: f.key, at: f.due_at, followup: f });
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export interface MonthCell {
  /** Local calendar day, "2026-11-04". */
  date: string;
  day: number;
  inMonth: boolean;
  today: boolean;
  events: DeadlineEvent[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Six Monday-first weeks around `month` (1-12), with each event on its local day. */
export function monthCells(
  year: number,
  month: number,
  events: readonly DeadlineEvent[],
  now: Date,
  tz: string,
): MonthCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = first.getTime() - offset * DAY;
  const t = zonedParts(now, tz);
  const today = `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  const byDay = new Map<string, DeadlineEvent[]>();
  for (const e of events) {
    const p = zonedParts(new Date(e.at), tz);
    const key = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start + i * DAY);
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return {
      date,
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1,
      today: date === today,
      events: byDay.get(date) ?? [],
    };
  });
}

export function monthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** "8 in November · 3 due within 7 days · 1 overdue" (deadlines only, not window openings). */
export function deadlinesSubtitle(events: readonly DeadlineEvent[], now: Date, tz: string): string {
  const deadlines = events.filter((e) => e.event === 'deadline' && !e.done);
  if (events.length === 0) return 'Results that have a deadline, plus reminders that are due.';
  const t = zonedParts(now, tz);
  const inMonth = deadlines.filter((e) => {
    const p = zonedParts(new Date(e.at), tz);
    return p.year === t.year && p.month === t.month && daysLeft(e.at, now, tz) >= 0;
  }).length;
  const week = deadlines.filter((e) => {
    const d = daysLeft(e.at, now, tz);
    return d >= 0 && d <= 7;
  }).length;
  const overdue = deadlines.filter((e) => {
    const d = daysLeft(e.at, now, tz);
    return d < 0 && d >= -30;
  }).length;
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: tz }).format(now);
  return [
    `${inMonth} in ${monthName}`,
    `${week} due within 7 days`,
    ...(overdue ? [`${overdue} overdue`] : []),
  ].join(' · ');
}

/** Month view moves by whole months. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const i = year * 12 + (month - 1) + delta;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}
