import { describe, expect, it } from 'vitest';
import type { DeadlineEvent, DueFollowup } from '../src/core/deadlines/list';
import { endOfLocalDay, startOfLocalDay } from '../src/core/time';
import {
  deadlinesSubtitle,
  dueSoon,
  groupEvents,
  leftChip,
  monthCells,
  monthTitle,
  shiftMonth,
  urgency,
} from '../src/renderer/src/lib/deadlines';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-11-04T09:00:00.000Z'); // Wed Nov 4, 10:00 in Tunis

let n = 0;
function ev(day: [number, number, number], over: Partial<DeadlineEvent> = {}): DeadlineEvent {
  n += 1;
  const event = over.event ?? 'deadline';
  const at = (event === 'opens' ? startOfLocalDay : endOfLocalDay)(...day, TZ).toISOString();
  return {
    key: `manual:${n}:${event}`,
    target_type: 'manual',
    target_id: n,
    event,
    title: `Item ${n}`,
    org: 'Acme',
    at,
    status: 'confirmed',
    url: null,
    sentence: null,
    tracked: true,
    done: false,
    snoozed_until: null,
    ...over,
  };
}

describe('deadline chips and urgency', () => {
  it('counts calendar days in the user time zone', () => {
    expect(leftChip(ev([2026, 11, 4]), NOW, TZ)).toEqual({
      label: 'Today',
      tone: 'amber',
      dashed: false,
    });
    expect(leftChip(ev([2026, 11, 5]), NOW, TZ).label).toBe('Tomorrow');
    expect(leftChip(ev([2026, 11, 18]), NOW, TZ)).toMatchObject({
      label: 'In 14 days',
      tone: 'amber',
    });
    expect(leftChip(ev([2026, 11, 30]), NOW, TZ)).toMatchObject({
      label: 'In 26 days',
      tone: 'neutral',
    });
    expect(leftChip(ev([2026, 11, 2]), NOW, TZ)).toMatchObject({
      label: 'Overdue · 2 days',
      tone: 'red',
    });
    expect(leftChip(ev([2026, 11, 3]), NOW, TZ).label).toBe('Overdue · 1 day');
    expect(leftChip(ev([2026, 12, 1], { status: 'expected' }), NOW, TZ).dashed).toBe(true);
    expect(leftChip(ev([2026, 11, 10], { event: 'opens' }), NOW, TZ).label).toBe('Opens in 6 days');
  });

  it('colors match the legend: overdue, within 7 days, later', () => {
    expect(urgency(ev([2026, 11, 1]), NOW, TZ)).toBe('overdue');
    expect(urgency(ev([2026, 11, 11]), NOW, TZ)).toBe('week');
    expect(urgency(ev([2026, 11, 12]), NOW, TZ)).toBe('later');
  });
});

describe('list groups and due soon', () => {
  const events = [
    ev([2026, 9, 1]), // more than 30 days ago: hidden
    ev([2026, 11, 2]),
    ev([2026, 11, 2], { done: true }), // done and past: hidden
    ev([2026, 11, 6]),
    ev([2026, 11, 20], { tracked: false }),
    ev([2027, 3, 31], { status: 'expected' }),
    ev([2026, 11, 1], { event: 'opens' }), // window already opened: hidden
  ];

  it('groups into overdue, this week, next 30 days and later', () => {
    expect(groupEvents(events, NOW, TZ).map((g) => [g.label, g.items.length])).toEqual([
      ['Overdue', 1],
      ['This week', 1],
      ['Next 30 days', 1],
      ['Later', 1],
    ]);
  });

  it('due soon: tracked, not done, not snoozed, within 14 days (overdue up to a week), plus follow-ups', () => {
    const snoozed = ev([2026, 11, 7], { snoozed_until: '2026-11-05T09:00:00.000Z' });
    const followup: DueFollowup = {
      key: 'pipeline:3:followup_1',
      target_type: 'pipeline',
      target_id: 3,
      reminder_id: 9,
      org: 'Weaviate',
      role: 'Backend Intern',
      due_at: '2026-11-03T08:00:00.000Z',
      kind: 'followup_1',
    };
    const items = dueSoon([...events, snoozed], [followup], NOW, TZ);
    expect(items.map((i) => i.key)).toEqual([
      events[1]!.key, // Nov 2, overdue
      'pipeline:3:followup_1', // due Nov 3
      events[3]!.key, // Nov 6
    ]);
    // The snooze ends: it is back.
    expect(dueSoon([snoozed], [], new Date('2026-11-05T10:00:00.000Z'), TZ)).toHaveLength(1);
  });

  it('subtitle counts this month, the next 7 days and overdue', () => {
    expect(deadlinesSubtitle(events, NOW, TZ)).toBe(
      '2 in November · 1 due within 7 days · 1 overdue',
    );
    expect(deadlinesSubtitle([], NOW, TZ)).toMatch(/plus reminders/);
  });
});

describe('month grid', () => {
  it('six Monday-first weeks with events on their local day', () => {
    const late = ev([2026, 11, 30]); // 22:59:59Z on Nov 30 in Tunis, still Nov 30
    const cells = monthCells(2026, 11, [late, ev([2026, 11, 4])], NOW, TZ);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({ date: '2026-10-26', inMonth: false }); // Nov 1 2026 is a Sunday
    expect(cells[6]).toMatchObject({ date: '2026-11-01', inMonth: true });
    expect(cells.find((c) => c.today)?.date).toBe('2026-11-04');
    expect(cells.find((c) => c.date === '2026-11-30')?.events).toEqual([late]);
    expect(cells.find((c) => c.date === '2026-11-04')?.events).toHaveLength(1);
  });

  it('titles and moves by month across years', () => {
    expect(monthTitle(2026, 11)).toBe('November 2026');
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
  });
});
