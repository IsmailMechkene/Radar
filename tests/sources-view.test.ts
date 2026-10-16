import { describe, expect, it } from 'vitest';
import type { SourceItem } from '../src/core/sources/manage';
import {
  brokenNote,
  errorLine,
  groupSources,
  lastRun,
  sourceDetail,
  sourcesSubtitle,
} from '../src/renderer/src/lib/sources';

const NOW = new Date('2026-10-16T08:00:00.000Z');
const base: SourceItem = {
  id: 1,
  kind: 'ashby',
  name: 'Mistral AI',
  url: 'https://jobs.ashbyhq.com/mistral.ai',
  access_method: 'api',
  config: { board: 'mistral.ai', org: 'Mistral AI' },
  note: null,
  tos_note: null,
  health: 'healthy',
  last_ok_at: '2026-10-16T07:46:00.000Z',
  last_error: null,
  consecutive_empty: 0,
  found: 42,
  paused: false,
  added_by_user: false,
  program: null,
};

describe('sources page text', () => {
  it('detail line per kind', () => {
    expect(sourceDetail(base)).toBe('Ashby job board · mistral.ai');
    expect(sourceDetail({ ...base, kind: 'arbeitnow' })).toBe('Arbeitnow job board API');
    expect(
      sourceDetail({
        ...base,
        kind: 'page',
        url: 'https://www.iaeste.tn/tunisia/',
        program: 'IAESTE Tunisia',
      }),
    ).toBe('Program page · iaeste.tn/tunisia');
    expect(
      sourceDetail({
        ...base,
        kind: 'careers_page',
        health: 'unavailable',
        note: 'Needs the careers-page adapter.',
      }),
    ).toBe('Needs the careers-page adapter.');
  });

  it('last run and errors', () => {
    expect(lastRun(base.last_ok_at, NOW)).toBe('14 min ago');
    expect(lastRun(null, NOW)).toBe('Never');
    expect(lastRun('2026-10-13T08:00:00.000Z', NOW)).toBe('3 days ago');
    expect(errorLine(base)).toEqual({ text: '—', tone: 'muted' });
    expect(errorLine({ ...base, consecutive_empty: 1, health: 'warning' })).toEqual({
      text: 'Nothing found 1 run in a row',
      tone: 'amber',
    });
    expect(errorLine({ ...base, last_error: 'GET answered 503', health: 'broken' })).toEqual({
      text: 'GET answered 503',
      tone: 'red',
    });
    expect(brokenNote(base)).toBeNull();
    expect(brokenNote({ ...base, consecutive_empty: 3, health: 'broken' })?.title).toBe(
      'Returned nothing for 3 runs.',
    );
  });

  it('groups in design order and summarizes health', () => {
    const items = [
      {
        ...base,
        id: 2,
        access_method: 'public_html' as const,
        kind: 'page',
        health: 'paused' as const,
      },
      base,
      { ...base, id: 3, health: 'broken' as const },
    ];
    expect(groupSources(items).map((g) => [g.label, g.items.length])).toEqual([
      ['API', 2],
      ['Public page', 1],
    ]);
    expect(sourcesSubtitle(items)).toBe('3 sources · 1 healthy · 1 broken · 1 paused');
  });
});
