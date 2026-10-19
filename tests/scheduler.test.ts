import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { setStarred, upsertOpportunity } from '../src/core/db/opportunities';
import { finishRun, startRun } from '../src/core/db/runs';
import { insertSource } from '../src/core/db/sources';
import type { Notice } from '../src/core/reminders/store';
import { seedDefaultSettings, setSetting } from '../src/core/settings/store';
import { endOfLocalDay } from '../src/core/time';
import { createScheduler, TICK_MS } from '../src/main/scheduler';
import { tempDb } from './helpers';

describe('scheduler', () => {
  let t: ReturnType<typeof tempDb>;
  let now: Date;
  let scans: string[];
  let watched: number;
  let notices: Notice[];
  let timers: { fn: () => void; ms: number }[];
  let intervals: { fn: () => void; ms: number }[];

  function make() {
    return createScheduler({
      db: t.db,
      now: () => now,
      scan: {
        run: async (trigger) => {
          scans.push(trigger);
          finishRun(
            t.db,
            startRun(t.db, trigger, now),
            { sourcesOk: 1, sourcesFailed: 0, newItems: 0, errorSummary: null },
            now,
          );
        },
        status: () => ({ running: false }),
      },
      watchPages: async () => {
        watched += 1;
      },
      notify: (n) => notices.push(n),
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
      clearTimeout: () => {},
      setInterval: (fn, ms) => intervals.push({ fn, ms }),
      clearInterval: () => {},
    });
  }

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    seedDefaultSettings(t.db);
    now = new Date('2026-11-15T08:00:00.000Z'); // 09:00 in Tunis
    scans = [];
    watched = 0;
    notices = [];
    timers = [];
    intervals = [];
    const src = insertSource(t.db, { kind: 'ashby', name: 'B', access_method: 'api' }, now);
    const { id } = upsertOpportunity(
      t.db,
      {
        dedupe_key: 'acme|ml intern|',
        source_id: src.id,
        org: 'Acme',
        title: 'ML Intern',
        opportunity_type: 'internship',
        url: 'https://acme.test/ml',
        deadline_at: endOfLocalDay(2026, 12, 15, 'Africa/Tunis').toISOString(),
        deadline_status: 'confirmed',
      },
      now,
    ).opportunity;
    setStarred(t.db, [id], true);
  });
  afterEach(() => t.cleanup());

  it('on startup: scans when no recent scan, watches pages, fires due reminders, ticks hourly', async () => {
    const s = make();
    s.start();
    const r = await s.tick('startup'); // joins the tick start() began
    expect(r).toEqual({ scanned: true, notices: 1, deferred: 0 });
    expect(scans).toEqual(['startup']);
    expect(watched).toBe(1);
    expect(notices.map((n) => n.title)).toEqual(['Deadline in 30 days: ML Intern']);
    expect(intervals.map((i) => i.ms)).toEqual([TICK_MS]);
  });

  it('does not scan again while the last successful scan is recent', async () => {
    const s = make();
    await s.tick('startup');
    now = new Date('2026-11-15T12:00:00.000Z');
    expect((await s.tick('resume')).scanned).toBe(false);
    now = new Date('2026-11-15T14:01:00.000Z'); // > 6 h (scan interval setting)
    expect((await s.tick('hourly')).scanned).toBe(true);
    expect(scans).toEqual(['startup', 'schedule']);
  });

  it('wake from sleep after 12 h scans and fires once', async () => {
    setSetting(t.db, 'scanIntervalHours', 24);
    const s = make();
    await s.tick('startup');
    now = new Date('2026-11-16T09:00:00.000Z');
    const r = await s.tick('resume');
    expect(r.scanned).toBe(true);
    expect(notices).toHaveLength(1); // nothing new due
  });

  it('quiet hours defer and schedule a tick for when they end', async () => {
    now = new Date('2026-11-15T22:30:00.000Z'); // 23:30 in Tunis
    const s = make();
    const r = await s.tick('startup');
    expect(r).toMatchObject({ notices: 0, deferred: 1 });
    expect(notices).toEqual([]);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(Date.parse('2026-11-16T07:00:00.000Z') - now.getTime() + 1000);

    now = new Date('2026-11-16T07:00:01.000Z');
    timers[0]!.fn();
    await s.tick('quiet-end');
    expect(notices.map((n) => n.kind)).toEqual(['deadline_t30']);
  });

  it('delivers new-match alerts on each tick; held ones count as deferred and set the quiet timer', async () => {
    let calls = 0;
    let held = 2;
    const s = createScheduler({
      db: t.db,
      now: () => now,
      scan: { run: async () => {}, status: () => ({ running: false }) },
      watchPages: async () => {},
      notify: (n) => notices.push(n),
      deliverMatches: () => {
        calls += 1;
        return { deferred: held };
      },
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
      setInterval: () => 0,
    });
    now = new Date('2026-11-15T22:30:00.000Z'); // 23:30 in Tunis: quiet
    const r = await s.tick('startup');
    expect(calls).toBe(1);
    expect(r.deferred).toBe(1 + 2); // the reminder and two matches
    expect(timers).toHaveLength(1);
    held = 0;
    now = new Date('2026-11-16T07:00:01.000Z');
    await s.tick('quiet-end');
    expect(calls).toBe(2);
  });

  it('makes the daily backup on a tick; a failing backup does not stop reminders', async () => {
    let backups = 0;
    const s = createScheduler({
      db: t.db,
      now: () => now,
      scan: { run: async () => {}, status: () => ({ running: false }) },
      watchPages: async () => {},
      dailyBackup: async () => {
        backups += 1;
        throw new Error('disk full');
      },
      notify: (n) => notices.push(n),
      setInterval: () => 0,
    });
    const r = await s.tick('startup');
    expect(backups).toBe(1);
    expect(r.notices).toBe(1);
  });

  it('a failing scan or page watch does not stop reminders', async () => {
    const s = createScheduler({
      db: t.db,
      now: () => now,
      scan: {
        run: async () => {
          throw new Error('offline');
        },
        status: () => ({ running: false }),
      },
      watchPages: async () => {
        throw new Error('offline');
      },
      notify: (n) => notices.push(n),
      setInterval: () => 0,
    });
    const r = await s.tick('startup');
    expect(r).toEqual({ scanned: false, notices: 1, deferred: 0 });
  });

  it('stop (lock) cuts a running tick short: no page checks or notifications after it', async () => {
    let release!: () => void;
    const s = createScheduler({
      db: t.db,
      now: () => now,
      scan: {
        run: () => new Promise<void>((resolve) => (release = resolve)),
        status: () => ({ running: false }),
      },
      watchPages: async () => {
        watched += 1;
      },
      notify: (n) => notices.push(n),
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
      clearTimeout: () => {},
      setInterval: (fn, ms) => intervals.push({ fn, ms }),
      clearInterval: () => {},
    });
    const tick = s.tick('startup');
    const stopped = s.stop();
    release();
    await stopped;
    expect(await tick).toEqual({ scanned: true, notices: 0, deferred: 0 });
    expect(watched).toBe(0);
    expect(notices).toEqual([]);
    expect(await s.tick('hourly')).toEqual({ scanned: false, notices: 0, deferred: 0 });
  });
});
