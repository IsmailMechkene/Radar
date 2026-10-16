import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { setStarred, upsertOpportunity } from '../src/core/db/opportunities';
import { addOpportunitiesToPipeline } from '../src/core/db/pipeline';
import { insertSource } from '../src/core/db/sources';
import { localMorning } from '../src/core/reminders/plan';
import { isQuietTime, quietEndsAt } from '../src/core/reminders/quiet';
import {
  describeReminder,
  fireDue,
  markPipelineSent,
  markReminderDone,
  snoozeReminder,
  syncReminders,
  type Notice,
} from '../src/core/reminders/store';
import { seedDefaultSettings } from '../src/core/settings/store';
import { endOfLocalDay, zonedParts } from '../src/core/time';
import { tempDb } from './helpers';

const TUNIS = 'Africa/Tunis';
const QUIET = { enabled: true, start: '22:00', end: '08:00' };
const LOUD = { enabled: false, start: '22:00', end: '08:00' };

const local = (iso: string, tz = TUNIS) => {
  const p = zonedParts(new Date(iso), tz);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
};

describe('reminders', () => {
  let t: ReturnType<typeof tempDb>;
  let oppId: number;
  const deadline = endOfLocalDay(2026, 12, 15, TUNIS).toISOString(); // 2026-12-15T22:59:59.999Z

  function addOpportunity(title: string, deadlineAt: string | null): number {
    const src = insertSource(
      t.db,
      { kind: 'ashby', name: `Board ${title}`, access_method: 'api' },
      new Date('2026-10-01T00:00:00Z'),
    );
    return upsertOpportunity(
      t.db,
      {
        dedupe_key: `acme|${title}|tunis`,
        source_id: src.id,
        org: 'Acme',
        title,
        opportunity_type: 'internship',
        url: `https://acme.test/${encodeURIComponent(title)}`,
        deadline_at: deadlineAt,
        deadline_status: deadlineAt ? 'confirmed' : 'unknown',
      },
      new Date('2026-10-01T00:00:00Z'),
    ).opportunity.id;
  }

  /** One tick: plan, then fire (as the scheduler does). */
  function tick(iso: string, quietHours = QUIET, timeZone = TUNIS) {
    const now = new Date(iso);
    syncReminders(t.db, now, timeZone);
    return fireDue(t.db, now, { timeZone, quietHours });
  }

  /** Hourly ticks from `from` to `to`; returns every notice with the time it fired. */
  function runHourly(from: string, to: string, quietHours = QUIET) {
    const fired: (Notice & { at: string })[] = [];
    for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 3_600_000) {
      const at = new Date(ms).toISOString();
      for (const n of tick(at, quietHours).notices) fired.push({ ...n, at });
    }
    return fired;
  }

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    seedDefaultSettings(t.db);
    oppId = addOpportunity('ML Intern', deadline);
  });
  afterEach(() => t.cleanup());

  it('plans nothing for an opportunity that is neither starred nor in the pipeline', () => {
    expect(syncReminders(t.db, new Date('2026-10-16T08:00:00Z'), TUNIS).inserted).toBe(0);
  });

  it('fires each deadline reminder exactly once, at 09:00 local on its day', () => {
    setStarred(t.db, [oppId], true);
    const fired = runHourly('2026-10-16T00:00:00Z', '2026-12-17T00:00:00Z');
    expect(fired.map((n) => [local(n.at), n.kind, n.title])).toEqual([
      ['2026-11-15 09:00', 'deadline_t30', 'Deadline in 30 days: ML Intern'],
      ['2026-12-01 09:00', 'deadline_t14', 'Deadline in 14 days: ML Intern'],
      ['2026-12-08 09:00', 'deadline_t7', 'Deadline in 7 days: ML Intern'],
      ['2026-12-13 09:00', 'deadline_t2', 'Deadline in 2 days: ML Intern'],
      ['2026-12-15 09:00', 'deadline_t0', 'Deadline today: ML Intern'],
    ]);
    expect(fired[0]!.body).toBe('Acme · closes Tue, 15 Dec 2026');
    // Planning is idempotent: one row per offset, all fired.
    const rows = t.db.prepare('SELECT COUNT(*) FROM reminders WHERE fired_at IS NOT NULL').pluck();
    expect(rows.get()).toBe(5);
    syncReminders(t.db, new Date('2026-12-20T00:00:00Z'), TUNIS);
    expect(t.db.prepare('SELECT COUNT(*) FROM reminders').pluck().get()).toBe(5);
  });

  it('pipeline opportunities get deadline reminders too', () => {
    addOpportunitiesToPipeline(t.db, [oppId], new Date('2026-10-16T08:00:00Z'));
    expect(syncReminders(t.db, new Date('2026-10-16T08:00:00Z'), TUNIS).inserted).toBe(5);
  });

  it('collapses reminders missed while the app was off into one per target', () => {
    setStarred(t.db, [oppId], true);
    const other = addOpportunity(
      'Backend Intern',
      endOfLocalDay(2026, 12, 20, TUNIS).toISOString(),
    );
    setStarred(t.db, [other], true);
    tick('2026-10-16T08:00:00Z'); // planned while running
    // Off from Oct 16 until Dec 14, 10:00 local: T-30, T-14, T-7 and T-2 of the first passed.
    const r = tick('2026-12-14T09:00:00Z');
    expect(r.notices.map((n) => [n.title, n.kind, n.collapsed])).toEqual([
      ['Deadline tomorrow: ML Intern', 'deadline_t2', 3],
      ['Deadline in 6 days: Backend Intern', 'deadline_t7', 2],
    ]);
    // Nothing repeats; the next one is T-0.
    expect(tick('2026-12-14T15:00:00Z').notices).toEqual([]);
    expect(tick('2026-12-15T08:00:00Z').notices.map((n) => n.kind)).toEqual(['deadline_t0']);
  });

  it('starring late fires one catch-up reminder, then the remaining offsets', () => {
    setStarred(t.db, [oppId], true);
    const fired = runHourly('2026-12-10T10:00:00Z', '2026-12-16T00:00:00Z');
    expect(fired.map((n) => [local(n.at), n.title])).toEqual([
      ['2026-12-10 11:00', 'Deadline in 5 days: ML Intern'],
      ['2026-12-13 09:00', 'Deadline in 2 days: ML Intern'],
      ['2026-12-15 09:00', 'Deadline today: ML Intern'],
    ]);
  });

  it('unstarring or a moved deadline removes pending reminders; history stays', () => {
    setStarred(t.db, [oppId], true);
    runHourly('2026-11-15T07:00:00Z', '2026-11-15T09:00:00Z'); // T-30 fires
    setStarred(t.db, [oppId], false);
    const r = syncReminders(t.db, new Date('2026-11-16T08:00:00Z'), TUNIS);
    expect(r.removed).toBe(4);
    expect(t.db.prepare('SELECT kind FROM reminders').pluck().all()).toEqual(['deadline_t30']);

    setStarred(t.db, [oppId], true);
    t.db
      .prepare('UPDATE opportunities SET deadline_at = ? WHERE id = ?')
      .run(endOfLocalDay(2026, 12, 31, TUNIS).toISOString(), oppId);
    syncReminders(t.db, new Date('2026-11-16T08:00:00Z'), TUNIS);
    const due = t.db
      .prepare('SELECT due_at FROM reminders WHERE fired_at IS NULL ORDER BY due_at')
      .pluck()
      .all() as string[];
    expect(due.map((d) => local(d))).toEqual([
      '2026-12-01 09:00',
      '2026-12-17 09:00',
      '2026-12-24 09:00',
      '2026-12-29 09:00',
      '2026-12-31 09:00',
    ]);
  });

  it('only confirmed deadlines of open, visible opportunities are reminded', () => {
    setStarred(t.db, [oppId], true);
    t.db.prepare("UPDATE opportunities SET deadline_status = 'unknown'").run();
    expect(syncReminders(t.db, new Date('2026-10-16T08:00:00Z'), TUNIS).inserted).toBe(0);
    t.db
      .prepare("UPDATE opportunities SET deadline_status = 'confirmed', closed_at = ?")
      .run('2026-10-10T00:00:00.000Z');
    expect(syncReminders(t.db, new Date('2026-10-16T08:00:00Z'), TUNIS).inserted).toBe(0);
  });

  it('follow-ups appear at +7 and +14 days after sent_at and fire while still Sent', () => {
    const [row] = addOpportunitiesToPipeline(t.db, [oppId], new Date('2026-10-16T08:00:00Z')).added;
    t.db.prepare("UPDATE opportunities SET deadline_at = NULL, deadline_status = 'unknown'").run();
    expect(syncReminders(t.db, new Date('2026-10-19T08:00:00Z'), TUNIS).inserted).toBe(0);

    markPipelineSent(t.db, row!, new Date('2026-10-19T10:30:00Z'), TUNIS);
    const p = t.db.prepare('SELECT status, followup1_at, followup2_at FROM pipeline').get() as {
      status: string;
      followup1_at: string;
      followup2_at: string;
    };
    expect(p.status).toBe('sent');
    expect([local(p.followup1_at), local(p.followup2_at)]).toEqual([
      '2026-10-26 09:00',
      '2026-11-02 09:00',
    ]);
    const fired = runHourly('2026-10-19T11:00:00Z', '2026-11-03T00:00:00Z');
    expect(fired.map((n) => [local(n.at), n.kind, n.title, n.body])).toEqual([
      [
        '2026-10-26 09:00',
        'followup_1',
        'Follow up with Acme',
        'ML Intern: sent 7 days ago and still waiting for an answer.',
      ],
      [
        '2026-11-02 09:00',
        'followup_2',
        'Follow up with Acme',
        'ML Intern: sent 14 days ago and still waiting for an answer.',
      ],
    ]);
  });

  it('a follow-up does not fire once the row has moved on', () => {
    const [row] = addOpportunitiesToPipeline(t.db, [oppId], new Date('2026-10-16T08:00:00Z')).added;
    t.db.prepare("UPDATE opportunities SET deadline_at = NULL, deadline_status = 'unknown'").run();
    markPipelineSent(t.db, row!, new Date('2026-10-19T10:30:00Z'), TUNIS);
    tick('2026-10-20T08:00:00Z');
    t.db.prepare("UPDATE pipeline SET status = 'interview'").run();
    expect(runHourly('2026-10-20T09:00:00Z', '2026-11-03T00:00:00Z')).toEqual([]);
  });

  it('quiet hours defer reminders instead of dropping them', () => {
    setStarred(t.db, [oppId], true);
    tick('2026-10-16T08:00:00Z');
    // 23:30 local on Nov 15: T-30 is due but it is quiet time.
    const quiet = tick('2026-11-15T22:30:00Z');
    expect(quiet).toEqual({ notices: [], deferred: 1 });
    expect(tick('2026-11-16T06:30:00Z').deferred).toBe(1); // 07:30 local, still quiet
    const after = tick('2026-11-16T07:00:00Z'); // 08:00 local
    expect(after.notices.map((n) => n.kind)).toEqual(['deadline_t30']);
    expect(after.deferred).toBe(0);
  });

  it('snooze makes a reminder fire again later; done stops it for good', () => {
    setStarred(t.db, [oppId], true);
    const [n] = runHourly('2026-11-15T07:00:00Z', '2026-11-15T08:00:00Z');
    snoozeReminder(t.db, n!.id, new Date('2026-11-15T12:00:00Z'));
    expect(tick('2026-11-15T11:00:00Z').notices).toEqual([]);
    const again = tick('2026-11-15T12:00:00Z').notices;
    expect(again.map((x) => x.id)).toEqual([n!.id]);
    snoozeReminder(t.db, n!.id, new Date('2026-11-16T12:00:00Z'));
    markReminderDone(t.db, n!.id, new Date('2026-11-15T13:00:00Z'));
    expect(tick('2026-11-16T12:00:00Z').notices).toEqual([]);
    expect(() => markReminderDone(t.db, n!.id, new Date())).toThrow(/No open reminder/);
  });
});

describe('time zones around midnight', () => {
  it('reminders are due at 09:00 local, across a DST change', () => {
    const deadline = endOfLocalDay(2026, 11, 20, 'Europe/London');
    expect(deadline.toISOString()).toBe('2026-11-20T23:59:59.999Z');
    // T-30 is in British summer time (UTC+1), T-0 in GMT.
    expect(localMorning(deadline, -30, 'Europe/London')).toBe('2026-10-21T08:00:00.000Z');
    expect(localMorning(deadline, 0, 'Europe/London')).toBe('2026-11-20T09:00:00.000Z');
    expect(localMorning(endOfLocalDay(2026, 11, 20, TUNIS), 0, TUNIS)).toBe(
      '2026-11-20T08:00:00.000Z',
    );
  });

  it('"today" and "tomorrow" follow the local calendar, not UTC', () => {
    const t = tempDb();
    try {
      migrate(t.db);
      const src = insertSource(
        t.db,
        { kind: 'ashby', name: 'B', access_method: 'api' },
        new Date(),
      );
      const add = (tz: string) =>
        upsertOpportunity(
          t.db,
          {
            dedupe_key: `x|${tz}`,
            source_id: src.id,
            org: 'Acme',
            title: `Intern ${tz}`,
            opportunity_type: 'internship',
            url: `https://acme.test/${tz}`,
            deadline_at: endOfLocalDay(2026, 12, 15, tz).toISOString(),
            deadline_status: 'confirmed',
          },
          new Date(),
        ).opportunity.id;
      const title = (id: number, tz: string, iso: string) =>
        describeReminder(
          t.db,
          {
            id: 1,
            target_type: 'opportunity',
            target_id: id,
            due_at: iso,
            kind: 'deadline_t0',
            fired_at: null,
            snoozed_until: null,
            done_at: null,
          },
          new Date(iso),
          tz,
        )!.title;
      const tunis = add(TUNIS);
      const london = add('Europe/London');
      // 23:30Z on Dec 14 is 00:30 on Dec 15 in Tunis but still 23:30 on Dec 14 in London.
      expect(title(tunis, TUNIS, '2026-12-14T23:30:00Z')).toBe(
        'Deadline today: Intern Africa/Tunis',
      );
      expect(title(london, 'Europe/London', '2026-12-14T23:30:00Z')).toBe(
        'Deadline tomorrow: Intern Europe/London',
      );
      // 22:30Z on Dec 15: 23:30 in Tunis (still today); London deadline ends at 23:59:59Z.
      expect(title(tunis, TUNIS, '2026-12-15T22:30:00Z')).toBe(
        'Deadline today: Intern Africa/Tunis',
      );
      expect(title(tunis, TUNIS, '2026-12-15T23:30:00Z')).toBe(
        'Deadline passed: Intern Africa/Tunis',
      );
      expect(title(london, 'Europe/London', '2026-12-15T23:30:00Z')).toBe(
        'Deadline today: Intern Europe/London',
      );
    } finally {
      t.cleanup();
    }
  });

  it('quiet hours wrap midnight in the user time zone', () => {
    // 21:30Z is 22:30 in Tunis (quiet) and 21:30 in London (not quiet).
    const at = new Date('2026-11-15T21:30:00Z');
    expect(isQuietTime(at, QUIET, TUNIS)).toBe(true);
    expect(isQuietTime(at, QUIET, 'Europe/London')).toBe(false);
    expect(isQuietTime(new Date('2026-11-16T06:59:00Z'), QUIET, TUNIS)).toBe(true); // 07:59
    expect(isQuietTime(new Date('2026-11-16T07:00:00Z'), QUIET, TUNIS)).toBe(false); // 08:00
    expect(isQuietTime(at, LOUD, TUNIS)).toBe(false);
    expect(quietEndsAt(at, QUIET, TUNIS)?.toISOString()).toBe('2026-11-16T07:00:00.000Z');
    // After midnight the end is the same morning.
    expect(quietEndsAt(new Date('2026-11-16T01:00:00Z'), QUIET, TUNIS)?.toISOString()).toBe(
      '2026-11-16T07:00:00.000Z',
    );
    expect(quietEndsAt(new Date('2026-11-16T12:00:00Z'), QUIET, TUNIS)).toBeNull();
    // A daytime window (start before end) does not wrap.
    const day = { enabled: true, start: '12:00', end: '14:00' };
    expect(isQuietTime(new Date('2026-11-16T12:30:00Z'), day, TUNIS)).toBe(true); // 13:30
    expect(isQuietTime(new Date('2026-11-16T22:30:00Z'), day, TUNIS)).toBe(false);
  });
});
