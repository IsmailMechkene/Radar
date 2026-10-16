// Pure view logic for the Opportunities page: deadline chips, views, filters, sorting, "new"
// detection and the copy-for-review text. Unit tested; no DOM or React.
import type { OpportunityDetail, OpportunityListItem } from '../../../core/db/schemas';
import { calendarDaysBetween, formatLongDate, formatShortDate } from './dates';

type Item = OpportunityListItem;
export type Verdict = NonNullable<Item['verdict']>;
export type RemoteType = Item['remote_type'];

export interface Ctx {
  now: Date;
  timeZone: string;
  /** Items first seen after this instant count as new. */
  newSince: string;
}

// ---------- deadline chip (design `chip()`) ----------

export type DeadlineTone = 'red' | 'amber' | 'neutral' | 'none';

export interface DeadlineChip {
  short: string;
  long: string;
  tone: DeadlineTone;
  /** Inferred from a past cycle: dashed outline, "~" prefix, never presented as confirmed. */
  expected: boolean;
  /** Days until the deadline in the user's time zone; null when there is no date. */
  days: number | null;
}

export function daysUntilDeadline(item: Pick<Item, 'deadline_at'>, ctx: Ctx): number | null {
  if (!item.deadline_at) return null;
  return calendarDaysBetween(ctx.now, new Date(item.deadline_at), ctx.timeZone);
}

export function deadlineChip(
  item: Pick<Item, 'deadline_at' | 'deadline_status'>,
  ctx: Ctx,
): DeadlineChip {
  const days = daysUntilDeadline(item, ctx);
  if (days === null || !item.deadline_at) {
    return item.deadline_status === 'rolling'
      ? { short: 'Rolling', long: 'Rolling deadline', tone: 'none', expected: false, days: null }
      : { short: 'No deadline', long: 'No deadline', tone: 'none', expected: false, days: null };
  }
  const label = formatShortDate(item.deadline_at, ctx.timeZone);
  let short: string;
  let long: string;
  let tone: DeadlineTone;
  if (days < 0) {
    short = 'Overdue';
    long = days === -1 ? 'Overdue by 1 day' : `Overdue by ${-days} days`;
    tone = 'red';
  } else if (days === 0) {
    short = 'Closes today';
    long = 'Closes today';
    tone = 'amber';
  } else if (days <= 14) {
    short = days === 1 ? '1 day left' : `${days} days left`;
    long = days === 1 ? 'Closes tomorrow' : `Closes in ${days} days`;
    tone = 'amber';
  } else {
    short = label;
    long = `Closes ${label}`;
    tone = 'neutral';
  }
  const expected = item.deadline_status === 'expected';
  if (expected) {
    short = `~ ${short}`;
    long = days >= 0 && days <= 14 ? `Expected in ${days} days` : `Expected ${label}`;
  }
  return { short, long, tone, expected, days };
}

// ---------- views and filters ----------

export const VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'strong', label: 'Strong matches' },
  { id: 'soon', label: 'Closing soon' },
  { id: 'remote', label: 'Remote' },
  { id: 'starred', label: 'Starred' },
] as const;
export type ViewId = (typeof VIEWS)[number]['id'];

export const DEADLINE_WINDOWS = [
  { id: '7', label: 'Closing within 7 days' },
  { id: '14', label: 'Closing within 14 days' },
  { id: '30', label: 'Closing within 30 days' },
  { id: 'has', label: 'Has deadline' },
  { id: 'none', label: 'No deadline' },
] as const;
export type DeadlineWindow = (typeof DEADLINE_WINDOWS)[number]['id'];

export const SCORE_FLOORS = [40, 60, 75] as const;

export const VERDICT_LABELS: Record<Verdict, string> = {
  apply: 'Apply',
  maybe: 'Maybe',
  needs_review: 'Needs review',
  skip: 'Skip',
};

export const REMOTE_LABELS: Record<RemoteType, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: 'Not stated',
};

export interface Filters {
  verdicts: Verdict[];
  minScore: number | null;
  remote: RemoteType[];
  locations: string[];
  sources: string[];
  deadline: DeadlineWindow | null;
  newOnly: boolean;
}

export const NO_FILTERS: Filters = {
  verdicts: [],
  minScore: null,
  remote: [],
  locations: [],
  sources: [],
  deadline: null,
  newOnly: false,
};

export function activeFilterCount(f: Filters): number {
  return (
    (f.verdicts.length ? 1 : 0) +
    (f.minScore !== null ? 1 : 0) +
    (f.remote.length ? 1 : 0) +
    (f.locations.length ? 1 : 0) +
    (f.sources.length ? 1 : 0) +
    (f.deadline ? 1 : 0) +
    (f.newOnly ? 1 : 0)
  );
}

export function isNew(item: Pick<Item, 'first_seen_at'>, ctx: Pick<Ctx, 'newSince'>): boolean {
  return item.first_seen_at > ctx.newSince;
}

/** First visit: the last 3 days count as new. */
export function newSinceFor(lastSeenAt: string | null, now: Date): string {
  return lastSeenAt ?? new Date(now.getTime() - 3 * 86_400_000).toISOString();
}

function inWindow(days: number | null, max: number): boolean {
  return days !== null && days >= 0 && days <= max;
}

export function matchesView(item: Item, view: ViewId, ctx: Ctx): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'strong':
      return item.verdict === 'apply';
    case 'soon':
      return inWindow(daysUntilDeadline(item, ctx), 14);
    case 'remote':
      return item.remote_type === 'remote';
    case 'starred':
      return item.starred;
  }
}

export function matchesDeadline(item: Item, w: DeadlineWindow, ctx: Ctx): boolean {
  if (w === 'has') return item.deadline_at !== null;
  if (w === 'none') return item.deadline_at === null;
  return inWindow(daysUntilDeadline(item, ctx), Number(w));
}

/** Every word of the query must appear in title, org, location, source or description. */
export function matchesQuery(item: Item, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [item.title, item.org, item.location, item.source_name, item.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

type FilterKey = keyof Filters;

/** Applies view, filters and query. `except` skips one filter (for counts inside its menu). */
export function applyFilters(
  items: readonly Item[],
  view: ViewId,
  f: Filters,
  query: string,
  ctx: Ctx,
  except?: FilterKey,
): Item[] {
  return items.filter(
    (i) =>
      matchesView(i, view, ctx) &&
      (except === 'verdicts' ||
        !f.verdicts.length ||
        (i.verdict !== null && f.verdicts.includes(i.verdict))) &&
      (except === 'minScore' || f.minScore === null || (i.score ?? -1) >= f.minScore) &&
      (except === 'remote' || !f.remote.length || f.remote.includes(i.remote_type)) &&
      (except === 'locations' || !f.locations.length || f.locations.includes(i.location ?? '')) &&
      (except === 'sources' || !f.sources.length || f.sources.includes(i.source_name)) &&
      (except === 'deadline' || !f.deadline || matchesDeadline(i, f.deadline, ctx)) &&
      (except === 'newOnly' || !f.newOnly || isNew(i, ctx)) &&
      matchesQuery(i, query),
  );
}

/** Count per saved view with the current filters and query applied. */
export function viewCounts(
  items: readonly Item[],
  f: Filters,
  query: string,
  ctx: Ctx,
): Record<ViewId, number> {
  const base = applyFilters(items, 'all', f, query, ctx);
  return Object.fromEntries(
    VIEWS.map((v) => [v.id, base.filter((i) => matchesView(i, v.id, ctx)).length]),
  ) as Record<ViewId, number>;
}

/** Distinct values with counts, most common first (location and source menus). */
export function valueCounts(
  values: readonly (string | null)[],
): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// ---------- sorting ----------

export const SORTS = [
  { id: 'score', label: 'Score' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'newest', label: 'Newest' },
  { id: 'posted', label: 'Posted' },
] as const;
export type SortId = (typeof SORTS)[number]['id'];

const byNewest = (a: Item, b: Item) => b.first_seen_at.localeCompare(a.first_seen_at);

export function sortItems(items: readonly Item[], sort: SortId): Item[] {
  const out = [...items];
  switch (sort) {
    case 'score':
      return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || byNewest(a, b));
    case 'deadline':
      return out.sort((a, b) => {
        if (a.deadline_at === b.deadline_at) return (b.score ?? -1) - (a.score ?? -1);
        if (!a.deadline_at) return 1;
        if (!b.deadline_at) return -1;
        return a.deadline_at.localeCompare(b.deadline_at);
      });
    case 'newest':
      return out.sort(byNewest);
    case 'posted':
      return out.sort((a, b) =>
        (b.posted_at ?? b.first_seen_at).localeCompare(a.posted_at ?? a.first_seen_at),
      );
  }
}

// ---------- empty state ----------

/** One sentence explaining why nothing matches, e.g. "No Apply roles closing within 7 days in Berlin." */
export function describeEmpty(view: ViewId, f: Filters, query: string): string {
  const verdicts = f.verdicts.map((v) => VERDICT_LABELS[v]).join(' or ');
  const parts = [`No ${verdicts ? `${verdicts} ` : ''}roles`];
  if (view === 'starred') parts.push('that you starred');
  if (view === 'remote' || f.remote.length)
    parts.push(
      f.remote.length ? `(${f.remote.map((r) => REMOTE_LABELS[r]).join(', ')})` : '(remote)',
    );
  if (view === 'soon') parts.push('closing within 14 days');
  if (f.deadline) {
    const w = DEADLINE_WINDOWS.find((d) => d.id === f.deadline)!;
    parts.push(
      f.deadline === 'has'
        ? 'with a deadline'
        : f.deadline === 'none'
          ? 'without a deadline'
          : w.label.toLowerCase(),
    );
  }
  if (f.minScore !== null) parts.push(`scoring ${f.minScore} or more`);
  if (f.locations.length) parts.push(`in ${f.locations.join(', ')}`);
  if (f.sources.length) parts.push(`from ${f.sources.join(', ')}`);
  if (f.newOnly) parts.push('new since your last visit');
  if (query.trim()) parts.push(`matching “${query.trim()}”`);
  return `${parts.join(' ')}.`;
}

// ---------- detail helpers ----------

export const VERDICT_HEADLINES: Record<Verdict, string> = {
  apply: 'Strong match',
  maybe: 'Worth a look',
  needs_review: 'Check eligibility first',
  skip: 'Weak match',
};

export interface EligibilityNote {
  label: string;
  detail: string;
}

/** One note per line; "Label: detail" splits at the first colon. */
export function parseEligibilityNotes(text: string | null): EligibilityNote[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(': ');
      return i > 0
        ? { label: line.slice(0, i), detail: line.slice(i + 2) }
        : { label: line, detail: '' };
    });
}

export function wordCount(text: string | null): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

/** Plain text for "Copy for deep review": everything needed to judge the posting elsewhere. */
export function deepReviewText(d: OpportunityDetail, ctx: Pick<Ctx, 'now' | 'timeZone'>): string {
  const lines: string[] = [
    `${d.title}`,
    `${[d.org, d.location, REMOTE_LABELS[d.remote_type]].filter(Boolean).join(' · ')}`,
  ];
  lines.push(`Link: ${d.apply_url ?? d.url}`);
  if (d.score !== null) {
    lines.push(
      '',
      `Score: ${Math.round(d.score)}/100${d.verdict ? ` (${VERDICT_LABELS[d.verdict]})` : ''}`,
    );
  }
  if (d.breakdown?.signals.length) {
    for (const s of d.breakdown.signals) {
      const pts = s.points > 0 ? `+${s.points}` : `${s.points}`;
      lines.push(`- ${s.label}: ${pts}${s.detail ? ` (${s.detail})` : ''}`);
    }
  }
  const notes = parseEligibilityNotes(d.eligibility_notes);
  if (notes.length) {
    lines.push('', 'Eligibility notes:');
    for (const n of notes) lines.push(`- ${n.label}${n.detail ? `: ${n.detail}` : ''}`);
  }
  const chip = deadlineChip(d, { ...ctx, newSince: '' });
  lines.push(
    '',
    d.deadline_at
      ? `Deadline: ${formatLongDate(d.deadline_at, ctx.timeZone)} (${d.deadline_status}, ${chip.long.toLowerCase()})`
      : `Deadline: ${chip.long.toLowerCase()}`,
  );
  if (d.deadline_text) lines.push(`Quoted: “${d.deadline_text}”`);
  if (d.sources.length) {
    lines.push('', 'Sources:');
    for (const s of d.sources) lines.push(`- ${s.name}: ${s.url}`);
  }
  if (d.description) lines.push('', 'Description:', d.description);
  return lines.join('\n');
}

// ---------- org monogram ----------

const SUFFIXES = new Set(['ai', 'inc', 'inc.', 'ltd', 'llc', 'gmbh', 'sas', 'sa', 'ag', 'office']);

/** "Hugging Face" -> "HF", "Mistral AI" -> "M", "MBZUAI" -> "MB", "InstaDeep" -> "ID", "Erasmus+ office" -> "E+". */
export function monogram(org: string): string {
  const words = org.split(/\s+/).filter((w) => w && !SUFFIXES.has(w.toLowerCase()));
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const w = words[0] ?? org;
  if (/^[A-Z0-9]{3,}$/.test(w)) return w.slice(0, 2);
  if (w.endsWith('+')) return `${w[0]!.toUpperCase()}+`;
  // CamelCase: capitals that start a lowercase run ("InstaDeep" -> "ID", "DeepL" -> "D").
  const caps = w.match(/[A-Z](?=[a-z])/g);
  if (caps && caps.length >= 2) return caps.slice(0, 2).join('');
  return w[0]?.toUpperCase() ?? '?';
}

/** Stable hue (0-359) per organisation for the monogram tile. */
export function monogramHue(org: string): number {
  let h = 0;
  for (const ch of org) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}
