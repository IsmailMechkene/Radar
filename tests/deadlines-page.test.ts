import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { setStarred, upsertOpportunity } from '../src/core/db/opportunities';
import { createPipelineRow, updatePipelineRow } from '../src/core/db/pipeline';
import { insertSource } from '../src/core/db/sources';
import { foldLine, icsText, toIcs } from '../src/core/deadlines/ics';
import {
  addManualDeadline,
  listDeadlines,
  markTargetDone,
  removeManualDeadline,
  snoozeTarget,
  undoDone,
  type DeadlineEvent,
} from '../src/core/deadlines/list';
import { parseSeedPrograms, syncSeedPrograms } from '../src/core/programs/seeds';
import { fireDue, syncReminders } from '../src/core/reminders/store';
import { endOfLocalDay } from '../src/core/time';
import { tempDb } from './helpers';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-10-16T08:00:00.000Z');
const LOUD = { enabled: false, start: '22:00', end: '08:00' };

describe('deadlines list', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    const programs = parseSeedPrograms(
      JSON.parse(readFileSync(join(__dirname, '..', 'seeds', 'programs.json'), 'utf8')),
    );
    syncSeedPrograms(t.db, programs, TZ, NOW);
  });
  afterEach(() => t.cleanup());

  const manualNotices = (at: Date) =>
    fireDue(t.db, at, { timeZone: TZ, quietHours: LOUD }).notices.filter(
      (n) => n.target_type === 'manual',
    );

  function addOpportunity(title: string, day: number | null) {
    const src = insertSource(
      t.db,
      { kind: 'ashby', name: `B ${title}`, access_method: 'api' },
      NOW,
    );
    return upsertOpportunity(
      t.db,
      {
        dedupe_key: `acme|${title}|`,
        source_id: src.id,
        org: 'Acme',
        title,
        opportunity_type: 'internship',
        url: `https://acme.test/${encodeURIComponent(title)}`,
        deadline_at: day ? endOfLocalDay(2026, 11, day, TZ).toISOString() : null,
        deadline_status: day ? 'confirmed' : 'unknown',
        deadline_text: day ? `Apply by November ${day}, 2026.` : null,
      },
      NOW,
    ).opportunity.id;
  }

  it('lists opportunities with a deadline, program windows (expected) and manual deadlines', () => {
    const starred = addOpportunity('ML Intern', 20);
    addOpportunity('Backend Intern', 25);
    addOpportunity('No deadline', null);
    setStarred(t.db, [starred], true);
    addManualDeadline(
      t.db,
      { title: 'Erasmus+ file', org: 'School office', date: '2026-11-10' },
      TZ,
      NOW,
    );

    const { events } = listDeadlines(t.db, NOW);
    const brief = events.map((e) => `${e.key} ${e.status}${e.tracked ? ' tracked' : ''}`);
    // By date: Hugging Face opens Nov 1 (00:00), InstaDeep closes Nov 1 (23:59), then November.
    expect(brief.slice(0, 5)).toEqual([
      'program:7:opens expected tracked',
      'program:6:deadline expected tracked',
      'manual:1:deadline confirmed tracked',
      'opportunity:1:deadline confirmed tracked',
      'opportunity:2:deadline confirmed',
    ]);
    expect(events.find((e) => e.key === 'opportunity:1:deadline')?.sentence).toBe(
      'Apply by November 20, 2026.',
    );
    expect(events.some((e) => e.title === 'No deadline')).toBe(false);
    // Rolling and unknown programs have no dated event.
    expect(events.some((e) => e.title === 'KAUST VSRP')).toBe(false);
  });

  it('snooze hides an item until later and makes it fire again; done stops it, undo restores', () => {
    const id = addManualDeadline(t.db, { title: 'Portfolio', date: '2026-10-25' }, TZ, NOW);
    syncReminders(t.db, NOW, TZ); // catch-up: T-14 (Oct 11) is past, fires now
    expect(manualNotices(NOW).map((n) => n.title)).toContain('Deadline in 9 days: Portfolio');
    const until = new Date('2026-10-17T08:00:00.000Z');
    snoozeTarget(t.db, 'manual', id, until, NOW);
    const ev = () =>
      listDeadlines(t.db, NOW).events.find((e) => e.key === `manual:${id}:deadline`)!;
    expect(ev().snoozed_until).toBe(until.toISOString());
    expect(manualNotices(until)).toHaveLength(1);

    const ids = markTargetDone(t.db, 'manual', id, NOW);
    expect(ids.length).toBeGreaterThan(1); // future offsets too
    expect(ev().done).toBe(true);
    syncReminders(t.db, new Date('2026-10-23T08:00:00.000Z'), TZ);
    expect(manualNotices(new Date('2026-10-23T08:00:00.000Z'))).toEqual([]);
    expect(undoDone(t.db, ids)).toBe(ids.length);
    expect(ev().done).toBe(false);
  });

  it('snoozing something with nothing due yet is refused', () => {
    const id = addManualDeadline(t.db, { title: 'Far away', date: '2027-06-01' }, TZ, NOW);
    syncReminders(t.db, NOW, TZ);
    expect(() => snoozeTarget(t.db, 'manual', id, new Date('2026-10-17T00:00:00Z'), NOW)).toThrow(
      /No reminder is due/,
    );
  });

  it('lists follow-ups that are due while the row still waits for an answer', () => {
    const row = createPipelineRow(t.db, { org: 'Weaviate', role: 'Backend Intern' }, TZ, NOW);
    updatePipelineRow(t.db, row.id, { status: 'sent' }, TZ, new Date('2026-10-01T10:00:00Z'));
    syncReminders(t.db, NOW, TZ);
    const { followups } = listDeadlines(t.db, NOW);
    // Sent on Oct 1: both follow-ups (Oct 8, Oct 15) passed; the latest is caught up.
    expect(followups.map((f) => [f.org, f.role, f.kind])).toEqual([
      ['Weaviate', 'Backend Intern', 'followup_2'],
    ]);
    updatePipelineRow(t.db, row.id, { status: 'interview' }, TZ, NOW);
    expect(listDeadlines(t.db, NOW).followups).toEqual([]);
  });

  it('validates and removes manual deadlines with their reminders', () => {
    expect(() => addManualDeadline(t.db, { title: ' ', date: '2026-11-01' }, TZ, NOW)).toThrow();
    expect(() => addManualDeadline(t.db, { title: 'X', date: '01/11/2026' }, TZ, NOW)).toThrow();
    const id = addManualDeadline(t.db, { title: 'X', date: '2026-11-01', url: '' }, TZ, NOW);
    syncReminders(t.db, NOW, TZ);
    expect(removeManualDeadline(t.db, id)).toBe(1);
    expect(
      t.db.prepare("SELECT COUNT(*) FROM reminders WHERE target_type = 'manual'").pluck().get(),
    ).toBe(0);
  });
});

describe('.ics export', () => {
  const ev = (over: Partial<DeadlineEvent>): DeadlineEvent => ({
    key: 'manual:1:deadline',
    target_type: 'manual',
    target_id: 1,
    event: 'deadline',
    title: 'Erasmus+ file',
    org: 'School office',
    at: endOfLocalDay(2026, 11, 10, TZ).toISOString(),
    status: 'confirmed',
    url: null,
    sentence: null,
    tracked: true,
    done: false,
    snoozed_until: null,
    ...over,
  });

  it('writes all-day events on the local day, with stable UIDs and an alarm', () => {
    const ics = toIcs(
      [
        ev({}),
        ev({
          key: 'program:4:deadline',
          title: 'Google Summer of Code',
          org: 'Google',
          status: 'expected',
          url: 'https://summerofcode.withgoogle.com/',
          at: endOfLocalDay(2027, 3, 31, TZ).toISOString(),
        }),
      ],
      TZ,
      NOW,
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:radar-manual-1-deadline@radar.local');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261111');
    expect(ics).toContain('SUMMARY:Deadline · School office: Erasmus+ file\r\n');
    expect(ics).toContain('DTSTART;VALUE=DATE:20270331');
    expect(ics.replace(/\r\n /g, '')).toContain(
      'Google Summer of Code (expected\\, from last cycle)',
    );
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('DTSTAMP:20261016T080000Z');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('escapes text and folds long lines at 75 octets', () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = `SUMMARY:${'é'.repeat(60)}`;
    const folded = foldLine(long);
    for (const line of folded.split('\r\n'))
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });
});
