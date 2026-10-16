import { describe, expect, it } from 'vitest';
import type { ProgramItem } from '../src/core/programs/manage';
import { endOfLocalDay, startOfLocalDay } from '../src/core/time';
import {
  alertTime,
  diffLines,
  displayUrl,
  EMPTY_PROGRAM,
  lastCycle,
  nextCheck,
  nextWindow,
  programDraft,
  programPatch,
  programsSubtitle,
  typicalWindow,
} from '../src/renderer/src/lib/programs';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-10-16T08:00:00.000Z');
const base: ProgramItem = {
  id: 1,
  name: 'IAESTE Tunisia',
  org: 'IAESTE Tunisia',
  url: 'https://www.iaeste.tn/tunisia/',
  status: 'watching',
  deadline_status: 'expected',
  typical_open: 'December',
  typical_deadline: 'February',
  last_cycle_deadline: '2026-02-28',
  expected_open_at: startOfLocalDay(2026, 12, 1, TZ).toISOString(),
  expected_deadline_at: endOfLocalDay(2027, 2, 28, TZ).toISOString(),
  next_check_at: '2026-10-17T04:00:00.000Z',
  notes: null,
  seeded: true,
  edited_at: null,
  source_id: 3,
  watch_url: 'https://www.iaeste.tn/tunisia/',
  last_checked_at: '2026-10-16T08:00:00.000Z',
  last_error: null,
  alert_id: null,
  alert_body: null,
  alert_at: null,
};

describe('program card text', () => {
  it('windows, last cycle and next check', () => {
    expect(typicalWindow(base)).toBe('December – February');
    expect(typicalWindow({ ...base, typical_open: null })).toBe('February');
    expect(
      typicalWindow({
        ...base,
        typical_open: 'Rolling',
        typical_deadline: 'Rolling, apply 4-6 months ahead',
      }),
    ).toBe('Rolling, apply 4-6 months ahead');
    expect(nextWindow(base, TZ)).toBe('Dec 1, 2026 – Feb 28, 2027');
    expect(nextWindow({ ...base, expected_open_at: null }, TZ)).toBe('Closes Feb 28, 2027');
    expect(
      nextWindow(
        { ...base, expected_open_at: null, expected_deadline_at: null, deadline_status: 'rolling' },
        TZ,
      ),
    ).toBe('Rolling');
    expect(lastCycle(base)).toBe('Closed Feb 28, 2026');
    expect(lastCycle({ ...base, last_cycle_deadline: null })).toBe('—');
    expect(nextCheck(base, NOW, TZ)).toEqual({ label: 'Tomorrow', tone: 'normal' });
    expect(nextCheck({ ...base, watch_url: null }, NOW, TZ).label).toBe('No page to watch');
    expect(nextCheck({ ...base, last_error: 'GET answered 403' }, NOW, TZ)).toEqual({
      label: 'Last check failed',
      tone: 'error',
    });
    expect(nextCheck({ ...base, last_checked_at: null }, NOW, TZ).label).toBe(
      'At the next hourly check',
    );
  });

  it('alert diff, time and url', () => {
    expect(diffLines('- Closes 9 November\n+ Closes 16 November\n… 2 more changed lines')).toEqual([
      { kind: 'removed', text: 'Closes 9 November' },
      { kind: 'added', text: 'Closes 16 November' },
      { kind: 'more', text: '… 2 more changed lines' },
    ]);
    expect(alertTime('2026-10-16T07:12:00.000Z', NOW, TZ)).toBe('Today 08:12');
    expect(alertTime('2026-10-15T07:12:00.000Z', NOW, TZ)).toBe('Yesterday 08:12');
    expect(displayUrl('https://www.iaeste.tn/tunisia/')).toBe('iaeste.tn/tunisia');
    expect(programsSubtitle([base, { ...base, id: 2, alert_id: 4 }])).toMatch(
      /1 changed, review\.$/,
    );
  });
});

describe('program drawer patch', () => {
  it('sends only changes; dates become local days', () => {
    const before = programDraft(base, TZ);
    expect(before).toMatchObject({ open: '2026-12-01', deadline: '2027-02-28', dates: 'expected' });
    expect(programPatch(before, before)).toEqual({});
    expect(programPatch({ ...before, deadline: '2027-02-15', dates: 'confirmed' }, before)).toEqual(
      {
        deadline_date: '2027-02-15',
        deadline_status: 'confirmed',
      },
    );
    expect(programPatch({ ...before, open: '' }, before)).toEqual({ open_date: null });
    expect(
      programPatch(
        { ...EMPTY_PROGRAM, name: 'Mitacs', url: 'https://www.mitacs.ca/' },
        EMPTY_PROGRAM,
      ),
    ).toEqual({
      name: 'Mitacs',
      url: 'https://www.mitacs.ca/',
    });
  });
});
