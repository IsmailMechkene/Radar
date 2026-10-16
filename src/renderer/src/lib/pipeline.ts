// Display rules for the Pipeline page. Pure: the clock and time zone are passed in.
import {
  PIPELINE_STATUSES,
  type PipelineItem,
  type PipelinePatch,
  type PipelineStatus,
} from '../../../core/db/pipeline';
import { zonedParts, zonedToUtc } from '../../../core/time';
import { formatShortDate } from './dates';

export { PIPELINE_STATUSES };

/** Status names and dot colors, from the design (STATUSES / STC). */
export const STATUS_META: Record<PipelineStatus, { label: string; dot: string }> = {
  not_started: { label: 'Not started', dot: 'bg-gray-fill' },
  drafted: { label: 'Drafted', dot: 'bg-fg-2' },
  sent: { label: 'Sent', dot: 'bg-accent' },
  followup_sent: { label: 'Follow-up sent', dot: 'bg-accent' },
  interview: { label: 'Interview', dot: 'bg-green-fill' },
  rejected: { label: 'Rejected', dot: 'bg-red-fill' },
  offer: { label: 'Offer', dot: 'bg-green-fill' },
  not_eligible: { label: 'Not eligible', dot: 'bg-gray-fill' },
};

export function statusCounts(items: readonly PipelineItem[]): Record<PipelineStatus, number> {
  const out = Object.fromEntries(PIPELINE_STATUSES.map((s) => [s, 0])) as Record<
    PipelineStatus,
    number
  >;
  for (const i of items) out[i.status] += 1;
  return out;
}

/** What shows under the organization: the row's own role, else the posting or program. */
export const roleOf = (i: PipelineItem) => i.role ?? i.opportunity_title ?? i.program_name ?? '';

export type FollowupTone = 'done' | 'due' | 'upcoming' | 'none';
export interface FollowupChip {
  label: string;
  tone: FollowupTone;
}

/** Follow-ups still expected while the row waits for an answer. */
const WAITING: Record<1 | 2, readonly PipelineStatus[]> = {
  1: ['sent'],
  2: ['sent', 'followup_sent'],
};

/**
 * The follow-up cell, as in the design: a due follow-up is shown alone ("Follow-up due Oct 26");
 * otherwise "+7 Oct 26" (done with a check, or upcoming with a clock). Nothing sent yet: "After
 * sending".
 */
export function followupChips(i: PipelineItem, now: Date, timeZone: string): FollowupChip[] {
  if (!i.sent_at) return [{ label: 'After sending', tone: 'none' }];
  const chips: FollowupChip[] = [];
  const entries: [1 | 2, string | null, string][] = [
    [1, i.followup1_at, '+7'],
    [2, i.followup2_at, '+14'],
  ];
  for (const [n, at, tag] of entries) {
    if (!at) continue;
    const day = formatShortDate(at, timeZone);
    const waiting = WAITING[n].includes(i.status);
    if (new Date(at).getTime() <= now.getTime()) {
      if (waiting) return [{ label: `Follow-up due ${day}`, tone: 'due' }];
      chips.push({ label: `${tag} ${day}`, tone: 'done' });
    } else if (waiting) chips.push({ label: `${tag} ${day}`, tone: 'upcoming' });
  }
  return chips.length ? chips : [{ label: '—', tone: 'none' }];
}

export function followupsDue(items: readonly PipelineItem[], now: Date, timeZone: string): number {
  return items.filter((i) => followupChips(i, now, timeZone)[0]?.tone === 'due').length;
}

/** "2026-10-19" -> "Oct 19" (a planned date is a calendar day, no time zone shift). */
export function formatLocalDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The local calendar day of an instant, as the value of an <input type="date">. */
export function toDateInput(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const p = zonedParts(new Date(iso), timeZone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** A date input's day as an instant: midday local, so the day never shifts. */
export function fromDateInput(value: string, timeZone: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return zonedToUtc(y, m, d, 12, 0, 0, 0, timeZone).toISOString();
}

/** Subtitle: "13 entries · 2 follow-ups due". */
export function pipelineSubtitle(items: readonly PipelineItem[], due: number): string {
  if (items.length === 0) return 'Applications from not started to offer, with follow-up dates.';
  const n = `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`;
  return due ? `${n} · ${due} follow-up${due === 1 ? '' : 's'} due` : n;
}

/** The drawer's form values (all text, as in the inputs). */
export interface PipelineDraft {
  org: string;
  role: string;
  status: PipelineStatus;
  planned: string;
  sent: string;
  contact_name: string;
  contact_url: string;
  notes: string;
}

export const EMPTY_DRAFT: PipelineDraft = {
  org: '',
  role: '',
  status: 'not_started',
  planned: '',
  sent: '',
  contact_name: '',
  contact_url: '',
  notes: '',
};

export function draftOf(i: PipelineItem, timeZone: string): PipelineDraft {
  return {
    org: i.org,
    role: i.role ?? '',
    status: i.status,
    planned: i.planned_send_date ?? '',
    sent: toDateInput(i.sent_at, timeZone),
    contact_name: i.contact_name ?? '',
    contact_url: i.contact_url ?? '',
    notes: i.notes ?? '',
  };
}

/**
 * Only the fields that changed. Text is sent as typed (the main process trims and turns empty
 * into nothing). Status Sent with no sent date lets the main process fill in today.
 */
export function patchOf(
  draft: PipelineDraft,
  before: PipelineDraft,
  timeZone: string,
): PipelinePatch {
  const p: PipelinePatch = {};
  if (draft.org.trim() !== before.org.trim()) p.org = draft.org;
  for (const k of ['role', 'contact_name', 'contact_url', 'notes'] as const) {
    if (draft[k].trim() !== before[k].trim()) p[k] = draft[k];
  }
  if (draft.status !== before.status) p.status = draft.status;
  if (draft.planned !== before.planned) p.planned_send_date = draft.planned || null;
  if (draft.sent !== before.sent) p.sent_at = fromDateInput(draft.sent, timeZone);
  return p;
}
