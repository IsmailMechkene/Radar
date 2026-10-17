import { describe, expect, it } from 'vitest';
import type { OpportunityDetail, OpportunityListItem } from '../src/core/db/schemas';
import {
  calendarDaysBetween,
  formatLongDate,
  formatShortDate,
  formatVisit,
  longAge,
  shortAge,
} from '../src/renderer/src/lib/dates';
import {
  activeFilterCount,
  applyFilters,
  deadlineChip,
  deepReviewText,
  describeEmpty,
  isNew,
  monogram,
  monogramHue,
  newSinceFor,
  NO_FILTERS,
  parseEligibilityNotes,
  sortItems,
  valueCounts,
  viewCounts,
  type Ctx,
} from '../src/renderer/src/lib/opportunities';

const NOW = new Date('2026-10-16T08:00:00.000Z'); // 09:00 in Tunis
const TZ = 'Africa/Tunis';
const ctx: Ctx = { now: NOW, timeZone: TZ, newSince: '2026-10-15T00:00:00.000Z' };
const inDays = (d: number, hourUtc = 21) => {
  const x = new Date(NOW.getTime() + d * 86_400_000);
  x.setUTCHours(hourUtc, 59, 0, 0);
  return x.toISOString();
};

let nextId = 1;
function item(over: Partial<OpportunityListItem> = {}): OpportunityListItem {
  return {
    id: nextId++,
    org: 'Acme',
    title: 'ML Intern',
    location: 'Paris',
    remote_type: 'onsite',
    opportunity_type: 'internship',
    url: 'https://example.com/x',
    apply_url: null,
    posted_at: '2026-10-14T08:00:00.000Z',
    deadline_at: null,
    deadline_status: 'unknown',
    score: 50,
    verdict: 'maybe',
    starred: false,
    first_seen_at: '2026-10-14T08:00:00.000Z',
    source_name: 'Greenhouse',
    source_kind: 'greenhouse',
    source_access_method: 'api',
    source_count: 1,
    summary: null,
    ...over,
  };
}

describe('dates in the user time zone', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    expect(calendarDaysBetween(NOW, new Date(inDays(0)), TZ)).toBe(0); // 22:59 Tunis, same day
    expect(calendarDaysBetween(NOW, new Date(inDays(0, 23)), TZ)).toBe(1); // 00:59 next day in Tunis
    expect(calendarDaysBetween(NOW, new Date(inDays(-2)), TZ)).toBe(-2);
  });

  it('formats dates and ages', () => {
    expect(formatShortDate('2026-11-12T21:59:00.000Z', TZ)).toBe('Nov 12');
    expect(formatLongDate('2026-11-12T21:59:00.000Z', TZ)).toBe('Thu, Nov 12, 2026');
    expect(formatVisit('2026-11-02T17:40:00.000Z', TZ)).toBe('Mon, Nov 2 · 18:40');
    expect(shortAge('2026-10-16T07:30:00.000Z', NOW)).toBe('now');
    expect(shortAge('2026-10-16T02:00:00.000Z', NOW)).toBe('6h');
    expect(shortAge('2026-10-14T08:00:00.000Z', NOW)).toBe('2d');
    expect(shortAge('2026-10-02T08:00:00.000Z', NOW)).toBe('2w');
    expect(longAge('2026-10-15T08:00:00.000Z', NOW)).toBe('1 day ago');
    expect(longAge('2026-10-16T01:00:00.000Z', NOW)).toBe('today');
  });
});

describe('deadline chip (design rules)', () => {
  it('no date, rolling, overdue, today, soon and later', () => {
    expect(deadlineChip(item(), ctx)).toMatchObject({ short: 'No deadline', tone: 'none' });
    expect(deadlineChip(item({ deadline_status: 'rolling' }), ctx).short).toBe('Rolling');
    expect(
      deadlineChip(item({ deadline_at: inDays(-2), deadline_status: 'confirmed' }), ctx),
    ).toMatchObject({
      short: 'Overdue',
      long: 'Overdue by 2 days',
      tone: 'red',
    });
    expect(
      deadlineChip(item({ deadline_at: inDays(0), deadline_status: 'confirmed' }), ctx).short,
    ).toBe('Closes today');
    expect(
      deadlineChip(item({ deadline_at: inDays(9), deadline_status: 'confirmed' }), ctx),
    ).toMatchObject({
      short: '9 days left',
      long: 'Closes in 9 days',
      tone: 'amber',
      expected: false,
    });
    expect(
      deadlineChip(item({ deadline_at: inDays(27), deadline_status: 'confirmed' }), ctx),
    ).toMatchObject({
      short: 'Nov 12',
      long: 'Closes Nov 12',
      tone: 'neutral',
    });
  });

  it('expected dates are marked, never shown as confirmed', () => {
    expect(
      deadlineChip(item({ deadline_at: inDays(2), deadline_status: 'expected' }), ctx),
    ).toMatchObject({
      short: '~ 2 days left',
      long: 'Expected in 2 days',
      expected: true,
    });
    expect(
      deadlineChip(item({ deadline_at: inDays(60), deadline_status: 'expected' }), ctx),
    ).toMatchObject({
      short: '~ Dec 15',
      long: 'Expected Dec 15',
    });
  });
});

describe('views, filters, search and sort', () => {
  const items = [
    item({
      title: 'ML Engineer Intern',
      score: 92,
      verdict: 'apply',
      remote_type: 'remote',
      starred: true,
      deadline_at: inDays(9),
      deadline_status: 'confirmed',
      first_seen_at: '2026-10-16T02:00:00.000Z',
    }),
    item({
      title: 'Backend Intern',
      score: 62,
      verdict: 'maybe',
      location: 'Berlin',
      deadline_at: inDays(27),
      deadline_status: 'confirmed',
      source_name: 'Lever',
    }),
    item({
      title: 'Senior Engineer',
      score: 22,
      verdict: 'skip',
      remote_type: 'remote',
    }),
    item({
      title: 'Data Intern',
      score: null,
      verdict: null,
      deadline_at: inDays(-1),
      deadline_status: 'confirmed',
    }),
  ];

  it('views', () => {
    expect(viewCounts(items, NO_FILTERS, '', ctx)).toEqual({
      all: 4,
      strong: 1,
      soon: 1,
      remote: 2,
      starred: 1,
    });
  });

  it('filters combine and each can be skipped for its own menu counts', () => {
    const f = { ...NO_FILTERS, minScore: 60, deadline: '30' as const };
    expect(applyFilters(items, 'all', f, '', ctx).map((i) => i.title)).toEqual([
      'ML Engineer Intern',
      'Backend Intern',
    ]);
    expect(applyFilters(items, 'all', f, '', ctx, 'deadline')).toHaveLength(2);
    expect(applyFilters(items, 'all', { ...NO_FILTERS, deadline: '7' }, '', ctx)).toHaveLength(0); // overdue is excluded
    expect(
      applyFilters(items, 'all', { ...NO_FILTERS, verdicts: ['apply', 'skip'] }, '', ctx),
    ).toHaveLength(2);
    expect(
      applyFilters(items, 'all', { ...NO_FILTERS, locations: ['Berlin'] }, '', ctx),
    ).toHaveLength(1);
    // A new-match alert shows exactly its postings.
    const alerted = [items[0]!.id, items[2]!.id];
    expect(
      applyFilters(items, 'all', { ...NO_FILTERS, matches: alerted }, '', ctx).map((i) => i.id),
    ).toEqual(alerted);
    expect(activeFilterCount({ ...NO_FILTERS, matches: alerted })).toBe(1);
    expect(applyFilters(items, 'all', { ...NO_FILTERS, sources: ['Lever'] }, '', ctx)).toHaveLength(
      1,
    );
    expect(applyFilters(items, 'all', { ...NO_FILTERS, newOnly: true }, '', ctx)).toHaveLength(1);
    expect(activeFilterCount(f)).toBe(2);
  });

  it('search matches every word across title, org, location and description', () => {
    // Descriptions are searched in the main process; its ids decide once they arrive.
    const senior = items.find((i) => i.title === 'Senior Engineer')!;
    const withIds = { ...ctx, searchIds: new Set([senior.id]) };
    expect(applyFilters(items, 'all', NO_FILTERS, 'rust', withIds).map((i) => i.title)).toEqual([
      'Senior Engineer',
    ]);
    // Until then, title, org, location and source are matched locally.
    expect(applyFilters(items, 'all', NO_FILTERS, 'rust', ctx)).toHaveLength(0);
    expect(applyFilters(items, 'all', NO_FILTERS, 'intern berlin', ctx)).toHaveLength(1);
    expect(applyFilters(items, 'all', NO_FILTERS, 'intern tokyo', ctx)).toHaveLength(0);
  });

  it('sorts by score, deadline, newest; unscored and undated go last', () => {
    // Skipped rows (22) rank after everything else, unscored ones included.
    expect(sortItems(items, 'score').map((i) => i.score)).toEqual([92, 62, null, 22]);
    const highSkip = { ...items[0]!, id: 999, score: 99, verdict: 'skip' as const };
    // A skip with a high score still ranks after every non-skipped row, then by score.
    expect(sortItems([highSkip, ...items], 'score').map((i) => i.score)).toEqual([
      92,
      62,
      null,
      99,
      22,
    ]);
    expect(sortItems(items, 'deadline').map((i) => i.title)).toEqual([
      'Data Intern',
      'ML Engineer Intern',
      'Backend Intern',
      'Senior Engineer',
    ]);
    expect(sortItems(items, 'newest')[0]?.title).toBe('ML Engineer Intern');
  });

  it('new since last visit', () => {
    expect(isNew(items[0]!, ctx)).toBe(true);
    expect(isNew(items[1]!, ctx)).toBe(false);
    expect(newSinceFor(null, NOW)).toBe('2026-10-13T08:00:00.000Z');
    expect(newSinceFor('2026-10-10T00:00:00.000Z', NOW)).toBe('2026-10-10T00:00:00.000Z');
  });

  it('explains an empty result', () => {
    expect(
      describeEmpty(
        'all',
        { ...NO_FILTERS, verdicts: ['apply'], deadline: '7', locations: ['Germany'] },
        '',
      ),
    ).toBe('No Apply roles closing within 7 days in Germany.');
    expect(describeEmpty('starred', NO_FILTERS, 'rust')).toBe(
      'No roles that you starred matching “rust”.',
    );
  });

  it('counts distinct values', () => {
    expect(valueCounts(['Paris', 'Berlin', 'Paris', null])).toEqual([
      { value: 'Paris', count: 2 },
      { value: 'Berlin', count: 1 },
    ]);
  });
});

describe('detail helpers', () => {
  it('parses eligibility notes', () => {
    expect(parseEligibilityNotes('Language: German C1 required\n\nNeeds a convention')).toEqual([
      { label: 'Language', detail: 'German C1 required' },
      { label: 'Needs a convention', detail: '' },
    ]);
    expect(parseEligibilityNotes(null)).toEqual([]);
  });

  it('builds the deep-review text', () => {
    const d: OpportunityDetail = {
      id: 1,
      dedupe_key: 'k',
      source_id: 1,
      org: 'Acme',
      title: 'ML Intern',
      location: 'Paris',
      remote_type: 'remote',
      opportunity_type: 'internship',
      language: 'en',
      url: 'https://example.com/1',
      apply_url: 'https://example.com/1/apply',
      description: 'Python.',
      posted_at: null,
      deadline_at: '2026-11-12T21:59:00.000Z',
      deadline_status: 'confirmed',
      deadline_text: 'Apply by 12 November.',
      eligibility_notes: 'Language: French B2',
      score: 80,
      verdict: 'apply',
      first_seen_at: NOW.toISOString(),
      last_seen_at: NOW.toISOString(),
      closed_at: null,
      starred: false,
      dismissed_at: null,
      breakdown: {
        version: 1,
        summary: 's',
        signals: [
          { id: 'role', label: 'Role match', detail: 'ML', points: 30 },
          { id: 'senior', label: 'Senior wording', detail: 'None', points: -5 },
        ],
      },
      sources: [
        {
          source_id: 1,
          name: 'Greenhouse',
          access_method: 'api',
          url: 'https://example.com/1',
          first_seen_at: NOW.toISOString(),
        },
      ],
    };
    const text = deepReviewText(d, { now: NOW, timeZone: TZ });
    expect(text).toContain('ML Intern\nAcme · Paris · Remote\nLink: https://example.com/1/apply');
    expect(text).toContain('Score: 80/100 (Apply)');
    expect(text).toContain('- Role match: +30 (ML)');
    expect(text).toContain('- Senior wording: -5 (None)');
    expect(text).toContain('- Language: French B2');
    expect(text).toContain('Deadline: Thu, Nov 12, 2026 (confirmed, closes nov 12)');
    expect(text).toContain('Quoted: “Apply by 12 November.”');
    expect(text).toContain('- Greenhouse: https://example.com/1');
    expect(text.endsWith('Description:\nPython.')).toBe(true);
  });

  it('monograms and hues are stable', () => {
    expect(monogram('Hugging Face')).toBe('HF');
    expect(monogram('Mistral AI')).toBe('M');
    expect(monogram('MBZUAI')).toBe('MB');
    expect(monogram('Erasmus+ (via my school)')).toBe('EV');
    expect(monogram('Erasmus+ office')).toBe('E+');
    expect(monogram('InstaDeep')).toBe('ID');
    expect(monogram('DeepL')).toBe('D');
    expect(monogramHue('Acme')).toBe(monogramHue('Acme'));
    expect(monogramHue('Acme')).toBeGreaterThanOrEqual(0);
    expect(monogramHue('Acme')).toBeLessThan(360);
  });
});
