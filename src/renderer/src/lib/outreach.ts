// Display rules for the Outreach page. Pure: the clock and time zone are passed in.
import { followupDue } from '../../../core/db/pipeline';
import { fieldKey, fieldsIn, type OutreachItem, type TemplateRow } from '../../../core/outreach';
import { formatShortDate } from './dates';

export { fieldsIn, render } from '../../../core/outreach';

/** Fields that are the same for every organization ("my name", "my school"). */
export const isSharedField = (name: string) => fieldKey(name).startsWith('my ');

/** Merge fields offered by "Insert" in the template editor. */
export const COMMON_FIELDS = [
  'first name',
  'company',
  'role',
  'product',
  'project',
  'sent date',
  'my name',
  'my school',
];

/** What fills [field]: what Radar knows, then shared values, then what was typed for this org. */
export function valuesFor(
  item: OutreachItem,
  shared: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...item.auto, ...shared, ...item.fields };
}

/** The draft's template: the chosen one, else follow-up once emailed, else the first cold one. */
export function templateFor(
  item: OutreachItem,
  templates: readonly TemplateRow[],
): TemplateRow | null {
  const chosen = templates.find((t) => t.id === item.template_id);
  if (chosen) return chosen;
  const kind = item.row.sent_at ? 'followup' : 'cold';
  return templates.find((t) => t.kind === kind) ?? templates[0] ?? null;
}

export interface OrgStatus {
  label: string;
  tone: 'muted' | 'amber' | 'green';
}

/** The small status next to each organization in the list (design: "Emailed Oct 19"). */
export function orgStatus(item: OutreachItem, ready: boolean, now: Date, tz: string): OrgStatus {
  const r = item.row;
  if (followupDue(r, now)) {
    // The latest follow-up date that has passed (the second once it is due, else the first).
    const passed = (d: string | null) => d !== null && new Date(d) <= now;
    const at = passed(r.followup2_at) ? r.followup2_at! : r.followup1_at!;
    return { label: `Follow-up due ${formatShortDate(at, tz)}`, tone: 'amber' };
  }
  switch (r.status) {
    case 'sent':
      return {
        label: r.sent_at ? `Emailed ${formatShortDate(r.sent_at, tz)}` : 'Emailed',
        tone: 'amber',
      };
    case 'followup_sent':
      return { label: 'Followed up', tone: 'muted' };
    case 'interview':
      return { label: 'Interview', tone: 'green' };
    case 'offer':
      return { label: 'Offer', tone: 'green' };
    case 'rejected':
      return { label: 'Rejected', tone: 'muted' };
    case 'not_eligible':
      return { label: 'Not eligible', tone: 'muted' };
    default:
      return {
        label: ready ? 'Draft ready' : r.status === 'drafted' ? 'Drafted' : 'Not started',
        tone: 'muted',
      };
  }
}

/** "You already emailed this organization on Oct 19." when a cold email is open for it. */
export function alreadyEmailed(
  item: OutreachItem,
  template: TemplateRow | null,
  now: Date,
  tz: string,
): { title: string; detail: string } | null {
  const r = item.row;
  if (!r.sent_at || template?.kind !== 'cold') return null;
  const next =
    [r.followup1_at, r.followup2_at].find((d) => d !== null && new Date(d) > now) ?? null;
  const past =
    [r.followup2_at, r.followup1_at].find((d) => d !== null && new Date(d) <= now) ?? null;
  return {
    title: `You already emailed this organization on ${formatShortDate(r.sent_at, tz)}.`,
    detail: past
      ? `A follow-up was due ${formatShortDate(past, tz)}.`
      : next
        ? `A follow-up is due ${formatShortDate(next, tz)}.`
        : '',
  };
}

export type Part =
  { kind: 'text'; text: string } | { kind: 'field'; name: string; value: string | null };

const FIELD_RE = /\[([\p{L}\p{N}][\p{L}\p{N} '’-]{0,39})\]/gu;

/** Text split into plain runs and fields (filled or not), for the preview's highlighting. */
export function parts(text: string, values: Readonly<Record<string, string>>): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(FIELD_RE)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    const v = values[fieldKey(m[1]!)]?.trim();
    out.push({ kind: 'field', name: fieldKey(m[1]!), value: v ? v : null });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** The fields a template asks for, the recipient first. */
export function draftFields(template: TemplateRow): string[] {
  return ['email', ...fieldsIn(template.subject, template.body).filter((f) => f !== 'email')];
}
