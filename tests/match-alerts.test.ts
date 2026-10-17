import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dueMatchAlerts,
  takeMatchAlerts,
  type MatchAlertOptions,
} from '../src/core/alerts/matches';
import { migrate } from '../src/core/db/migrate';
import { migrations } from '../src/core/db/migrations';
import { dismissOpportunities, upsertOpportunity } from '../src/core/db/opportunities';
import { addOpportunitiesToPipeline } from '../src/core/db/pipeline';
import { insertSource } from '../src/core/db/sources';
import { getSetting, seedDefaultSettings, setSetting } from '../src/core/settings/store';
import { tempDb } from './helpers';

// 2026-10-16 12:00 in Tunis (UTC+1): outside the default quiet hours (22:00-08:00).
const NOON = new Date('2026-10-16T11:00:00.000Z');
const TZ = 'Africa/Tunis';
const QUIET = { enabled: true, start: '22:00', end: '08:00' };

describe('new-match alerts', () => {
  let t: ReturnType<typeof tempDb>;
  let source: number;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    seedDefaultSettings(t.db);
    source = insertSource(
      t.db,
      { kind: 'greenhouse', name: 'Board', access_method: 'api' },
      NOON,
    ).id;
  });
  afterEach(() => t.cleanup());

  function posting(
    title: string,
    verdict: 'apply' | 'maybe' | 'skip' | null,
    score: number | null,
    extra: { type?: 'internship' | 'program'; src?: number } = {},
  ): number {
    const id = upsertOpportunity(
      t.db,
      {
        dedupe_key: `k|${title}`,
        source_id: extra.src ?? source,
        org: 'Datadog',
        title,
        location: 'Paris, France',
        opportunity_type: extra.type ?? 'internship',
        url: `https://x.test/${encodeURIComponent(title)}`,
      },
      NOON,
    ).opportunity.id;
    t.db
      .prepare('UPDATE opportunities SET verdict = ?, score = ? WHERE id = ?')
      .run(verdict, score, id);
    return id;
  }
  const opts = (o: Partial<MatchAlertOptions> = {}): MatchAlertOptions => ({
    mode: 'apply',
    now: NOON,
    timeZone: TZ,
    quietHours: QUIET,
    lastDigestAt: null,
    ...o,
  });
  const handled = (id: number) =>
    (
      t.db.prepare('SELECT alerted_at FROM opportunities WHERE id = ?').get(id) as {
        alerted_at: string | null;
      }
    ).alerted_at;

  it('one grouped alert for new Apply postings, best first; each posting only once', () => {
    const a = posting('Applied Science Intern', 'apply', 77);
    const b = posting('Product Management Intern', 'apply', 81);
    const c = posting('Sales Intern', 'skip', 20);
    const r = takeMatchAlerts(t.db, opts());
    expect(r.alert).toEqual({
      ids: [b, a],
      title: '2 new strong matches',
      body: 'Datadog · Product Management Intern (Paris, France) — 81\nDatadog · Applied Science Intern (Paris, France) — 77',
    });
    expect([a, b, c].every((id) => handled(id) === NOON.toISOString())).toBe(true);
    // Nothing again, even after a re-score turns the Skip into an Apply.
    t.db.prepare("UPDATE opportunities SET verdict = 'apply', score = 90 WHERE id = ?").run(c);
    expect(takeMatchAlerts(t.db, opts()).alert).toBeNull();
  });

  it('skips closed, dismissed, pipeline, program and sample postings; waits for unscored ones', () => {
    const dismissed = posting('Dismissed Intern', 'apply', 80);
    dismissOpportunities(t.db, [dismissed], NOON);
    const tracked = posting('Tracked Intern', 'apply', 80);
    addOpportunitiesToPipeline(t.db, [tracked], NOON);
    posting('GSoC', null, null, { type: 'program' });
    const sampleSrc = insertSource(
      t.db,
      { kind: 'sample', name: 'Sample', access_method: 'api' },
      NOON,
    ).id;
    posting('Sample Intern', 'apply', 90, { src: sampleSrc });
    const unscored = posting('Fresh Intern', null, null);
    expect(takeMatchAlerts(t.db, opts()).alert).toBeNull();
    expect(handled(unscored)).toBeNull(); // decided after its re-score
    t.db
      .prepare("UPDATE opportunities SET verdict = 'apply', score = 70 WHERE id = ?")
      .run(unscored);
    expect(takeMatchAlerts(t.db, opts()).alert?.ids).toEqual([unscored]);
  });

  it('Apply + Maybe mode, more than three, and Off', () => {
    for (const [i, v] of (['apply', 'maybe', 'maybe', 'maybe', 'skip'] as const).entries()) {
      posting(`Intern ${i}`, v, 80 - i * 10);
    }
    const r = takeMatchAlerts(t.db, opts({ mode: 'apply_maybe' }));
    expect(r.alert?.title).toBe('4 new matches (1 strong)');
    expect(r.alert?.body.split('\n')).toHaveLength(4);
    expect(r.alert?.body).toMatch(/and 1 more$/);
    posting('Later Intern', 'apply', 99);
    expect(takeMatchAlerts(t.db, opts({ mode: 'off' })).alert).toBeNull();
    expect(takeMatchAlerts(t.db, opts()).alert).toBeNull(); // handled while off, not saved up
  });

  it('quiet hours hold alerts, never drop them', () => {
    const id = posting('Night Intern', 'apply', 77);
    const night = new Date('2026-10-16T22:30:00.000Z'); // 23:30 in Tunis
    expect(takeMatchAlerts(t.db, opts({ now: night }))).toMatchObject({ alert: null, deferred: 1 });
    expect(handled(id)).toBeNull();
    const morning = new Date('2026-10-17T07:05:00.000Z'); // 08:05
    expect(takeMatchAlerts(t.db, opts({ now: morning })).alert?.ids).toEqual([id]);
  });

  it('daily summary: once a day from 09:00 local, with everything since', () => {
    const early = new Date('2026-10-16T06:00:00.000Z'); // 07:00 Tunis... inside quiet hours
    const a = posting('Morning Intern', 'apply', 70);
    expect(takeMatchAlerts(t.db, opts({ mode: 'daily', now: early })).alert).toBeNull();
    const nine = new Date('2026-10-16T08:10:00.000Z'); // 09:10
    const r = takeMatchAlerts(t.db, opts({ mode: 'daily', now: nine }));
    expect(r.alert).toMatchObject({ ids: [a], title: 'Today: new strong match' });
    expect(r.digestSent).toBe(true);
    const b = posting('Noon Intern', 'apply', 75);
    expect(
      takeMatchAlerts(t.db, opts({ mode: 'daily', now: NOON, lastDigestAt: nine.toISOString() })),
    ).toMatchObject({ alert: null, deferred: 1 });
    const tomorrow = new Date('2026-10-17T08:30:00.000Z');
    expect(
      takeMatchAlerts(
        t.db,
        opts({ mode: 'daily', now: tomorrow, lastDigestAt: nine.toISOString() }),
      ).alert?.ids,
    ).toEqual([b]);
  });

  it('dueMatchAlerts reads the settings and records the daily summary', () => {
    setSetting(t.db, 'matchAlerts', 'daily');
    posting('Digest Intern', 'apply', 70);
    expect(dueMatchAlerts(t.db, NOON).alert?.title).toBe('Today: new strong match');
    expect(getSetting(t.db, 'matchDigestAt')).toBe(NOON.toISOString());
    expect(getSetting(t.db, 'matchAlerts')).toBe('daily');
  });
});

describe('migration 11', () => {
  it('marks postings already stored as handled, so the backlog is not alerted', () => {
    const t = tempDb();
    try {
      migrate(t.db, () => NOON, migrations.slice(0, 10));
      const src = insertSource(t.db, { kind: 'ashby', name: 'B', access_method: 'api' }, NOON);
      t.db
        .prepare(
          `INSERT INTO opportunities (dedupe_key, source_id, org, title, opportunity_type, url,
             first_seen_at, last_seen_at, verdict, score)
           VALUES ('old', ?, 'Org', 'Old Intern', 'internship', 'https://x.test/old', ?, ?, 'apply', 90)`,
        )
        .run(src.id, NOON.toISOString(), NOON.toISOString());
      migrate(t.db, () => NOON);
      seedDefaultSettings(t.db);
      expect(
        takeMatchAlerts(t.db, {
          mode: 'apply',
          now: NOON,
          timeZone: TZ,
          quietHours: QUIET,
          lastDigestAt: null,
        }).alert,
      ).toBeNull();
    } finally {
      t.cleanup();
    }
  });
});
