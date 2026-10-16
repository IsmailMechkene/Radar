// Display rules for the Programs page. Pure: the clock and time zone are passed in.
import type { ProgramItem, ProgramPatch, ProgramStatus } from '../../../core/programs/manage';
import { zonedParts } from '../../../core/time';
import { calendarDaysBetween } from './dates';

export const PROGRAM_STATUS_LABEL: Record<ProgramStatus, string> = {
  watching: 'Watching',
  open: 'Open now',
  applied: 'Applied',
  closed: 'Closed',
  not_applicable: 'Not applicable',
};

export type DatesStatus = 'confirmed' | 'expected' | 'rolling' | 'unknown';
export const DATES_LABEL: Record<DatesStatus, string> = {
  confirmed: 'Confirmed',
  expected: 'Expected, unconfirmed',
  rolling: 'Rolling',
  unknown: 'No dates yet',
};

export const datesStatus = (p: ProgramItem): DatesStatus =>
  p.deadline_status === 'closed' ? 'unknown' : p.deadline_status;

const fmt = (iso: string, tz: string, withYear = true) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(new Date(iso));

/** "December – February" from the typical window text. */
export function typicalWindow(p: ProgramItem): string {
  const parts = [p.typical_open, p.typical_deadline].filter(Boolean);
  // "Rolling" + "Rolling, apply 4-6 months before the start": the second says it all.
  if (parts.length === 2 && parts[1]!.toLowerCase().startsWith(parts[0]!.toLowerCase())) {
    return parts[1]!;
  }
  return parts.length ? parts.join(' – ') : '—';
}

/** The next cycle's dates: "Dec 1, 2026 – Feb 28, 2027", "Closes Nov 1, 2026", "Rolling". */
export function nextWindow(p: ProgramItem, tz: string): string {
  const open = p.expected_open_at;
  const close = p.expected_deadline_at;
  if (open && close) return `${fmt(open, tz)} – ${fmt(close, tz)}`;
  if (close) return `Closes ${fmt(close, tz)}`;
  if (open) return `Opens ${fmt(open, tz)}`;
  return p.deadline_status === 'rolling' ? 'Rolling' : '—';
}

/** "Closed Feb 28, 2026" (a local calendar date, no time zone shift). */
export function lastCycle(p: ProgramItem): string {
  if (!p.last_cycle_deadline) return '—';
  const [y, m, d] = p.last_cycle_deadline.split('-').map(Number) as [number, number, number];
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return `Closed ${date}`;
}

export interface CheckLine {
  label: string;
  tone: 'normal' | 'muted' | 'error';
}

/** When the page is looked at next: "Today", "Tomorrow", "Oct 20"; or why it is not. */
export function nextCheck(p: ProgramItem, now: Date, tz: string): CheckLine {
  if (!p.watch_url) return { label: 'No page to watch', tone: 'muted' };
  if (p.last_error) return { label: 'Last check failed', tone: 'error' };
  if (!p.next_check_at || !p.last_checked_at)
    return { label: 'At the next hourly check', tone: 'normal' };
  const days = calendarDaysBetween(now, new Date(p.next_check_at), tz);
  const label = days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : fmt(p.next_check_at, tz, false);
  return { label, tone: 'normal' };
}

/** "Today 08:12", "Oct 18 08:12": when a change was found. */
export function alertTime(iso: string, now: Date, tz: string): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
  const days = calendarDaysBetween(new Date(iso), now, tz);
  return `${days === 0 ? 'Today' : days === 1 ? 'Yesterday' : fmt(iso, tz, false)} ${time}`;
}

export interface DiffLine {
  kind: 'removed' | 'added' | 'more';
  text: string;
}

/** The alert's short diff ("- old" / "+ new" / "… 3 more changed lines"). */
export function diffLines(body: string): DiffLine[] {
  return body
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) =>
      l.startsWith('- ')
        ? { kind: 'removed', text: l.slice(2) }
        : l.startsWith('+ ')
          ? { kind: 'added', text: l.slice(2) }
          : { kind: 'more', text: l },
    );
}

/** "developers.google.com/open-source/gsoc/timeline" */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}

/** The drawer's form values. */
export interface ProgramDraft {
  name: string;
  org: string;
  url: string;
  status: ProgramStatus;
  dates: DatesStatus;
  open: string;
  deadline: string;
  typical_open: string;
  typical_deadline: string;
  notes: string;
}

export const EMPTY_PROGRAM: ProgramDraft = {
  name: '',
  org: '',
  url: '',
  status: 'watching',
  dates: 'expected',
  open: '',
  deadline: '',
  typical_open: '',
  typical_deadline: '',
  notes: '',
};

const dateInput = (iso: string | null, tz: string) => {
  if (!iso) return '';
  const p = zonedParts(new Date(iso), tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

export function programDraft(p: ProgramItem, tz: string): ProgramDraft {
  return {
    name: p.name,
    org: p.org ?? '',
    url: p.url ?? '',
    status: p.status,
    dates: datesStatus(p),
    open: dateInput(p.expected_open_at, tz),
    deadline: dateInput(p.expected_deadline_at, tz),
    typical_open: p.typical_open ?? '',
    typical_deadline: p.typical_deadline ?? '',
    notes: p.notes ?? '',
  };
}

/** Only what changed. */
export function programPatch(draft: ProgramDraft, before: ProgramDraft): ProgramPatch {
  const p: ProgramPatch = {};
  for (const k of ['name', 'org', 'url', 'typical_open', 'typical_deadline', 'notes'] as const) {
    if (draft[k].trim() !== before[k].trim()) p[k] = draft[k];
  }
  if (draft.status !== before.status) p.status = draft.status;
  if (draft.dates !== before.dates) p.deadline_status = draft.dates;
  if (draft.open !== before.open) p.open_date = draft.open || null;
  if (draft.deadline !== before.deadline) p.deadline_date = draft.deadline || null;
  return p;
}

/** Subtitle: what the page is, plus how many pages changed. */
export function programsSubtitle(items: readonly ProgramItem[]): string {
  const changed = items.filter((p) => p.alert_id !== null).length;
  const base = 'Recurring student programs. Radar watches each page and flags changes.';
  return changed ? `${base} ${changed} changed, review.` : base;
}
