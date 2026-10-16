import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dismissOpportunities, setStarred, upsertOpportunity } from '../src/core/db/opportunities';
import { migrate } from '../src/core/db/migrate';
import { createPipelineRow, updatePipelineRow } from '../src/core/db/pipeline';
import { insertSource } from '../src/core/db/sources';
import { addManualDeadline, markTargetDone } from '../src/core/deadlines/list';
import { navCounts } from '../src/core/nav';
import { parseSeedPrograms, syncSeedPrograms } from '../src/core/programs/seeds';
import { syncReminders } from '../src/core/reminders/store';
import { endOfLocalDay } from '../src/core/time';
import { navBadges } from '../src/renderer/src/lib/nav-badges';
import { tempDb } from './helpers';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-10-20T08:00:00.000Z');
const opts = (newSince = '2026-10-18T00:00:00.000Z') => ({ now: NOW, timeZone: TZ, newSince });

describe('sidebar counts', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  it('all zero on an empty database', () => {
    expect(navCounts(t.db, opts())).toEqual({
      newOpportunities: 0,
      deadlinesDue: 0,
      followupsDue: 0,
      programsChanged: 0,
      sourcesBroken: 0,
    });
  });

  it('new opportunities since the last visit, open and not dismissed', () => {
    const src = insertSource(t.db, { kind: 'ashby', name: 'B', access_method: 'api' }, NOW);
    const add = (title: string, seen: string) =>
      upsertOpportunity(
        t.db,
        {
          dedupe_key: `acme|${title}|`,
          source_id: src.id,
          org: 'Acme',
          title,
          opportunity_type: 'internship',
          url: `https://acme.test/${title}`,
          deadline_at: title === 'Starred' ? endOfLocalDay(2026, 10, 25, TZ).toISOString() : null,
          deadline_status: title === 'Starred' ? 'confirmed' : 'unknown',
        },
        new Date(seen),
      ).opportunity.id;
    add('Old', '2026-10-10T00:00:00.000Z');
    add('New', '2026-10-19T00:00:00.000Z');
    const gone = add('Dismissed', '2026-10-19T00:00:00.000Z');
    const starred = add('Starred', '2026-10-19T00:00:00.000Z');
    dismissOpportunities(t.db, [gone], NOW);
    setStarred(t.db, [starred], true);
    syncReminders(t.db, NOW, TZ);
    expect(navCounts(t.db, opts())).toMatchObject({ newOpportunities: 2, deadlinesDue: 1 });
    // After a visit, nothing is new.
    expect(navCounts(t.db, opts(NOW.toISOString())).newOpportunities).toBe(0);
  });

  it('due soon, follow-ups, changed programs and broken sources use the pages’ rules', () => {
    const programs = parseSeedPrograms(
      JSON.parse(readFileSync(join(__dirname, '..', 'seeds', 'programs.json'), 'utf8')),
    );
    syncSeedPrograms(t.db, programs, TZ, NOW);
    // InstaDeep (Nov 1, 12 days) and Hugging Face opening (Nov 1) are tracked and due soon.
    const before = navCounts(t.db, opts()).deadlinesDue;
    expect(before).toBe(2);
    const id = addManualDeadline(t.db, { title: 'Erasmus+ file', date: '2026-10-25' }, TZ, NOW);
    syncReminders(t.db, NOW, TZ);
    expect(navCounts(t.db, opts()).deadlinesDue).toBe(3);
    markTargetDone(t.db, 'manual', id, NOW);
    expect(navCounts(t.db, opts()).deadlinesDue).toBe(2);

    const row = createPipelineRow(t.db, { org: 'Photoroom' }, TZ, NOW);
    updatePipelineRow(
      t.db,
      row.id,
      { status: 'sent', sent_at: '2026-10-10T10:00:00.000Z' },
      TZ,
      NOW,
    );
    expect(navCounts(t.db, opts()).followupsDue).toBe(1);
    updatePipelineRow(t.db, row.id, { status: 'interview' }, TZ, NOW);
    expect(navCounts(t.db, opts()).followupsDue).toBe(0);

    const p = t.db
      .prepare("SELECT id, source_id FROM programs WHERE name = 'IAESTE Tunisia'")
      .get() as {
      id: number;
      source_id: number;
    };
    const alert = t.db.prepare(
      `INSERT INTO alerts (kind, source_id, program_id, title, body, created_at)
       VALUES ('page_changed', ?, ?, 't', 'b', ?)`,
    );
    alert.run(p.source_id, p.id, NOW.toISOString());
    alert.run(p.source_id, p.id, NOW.toISOString()); // two changes, one program
    expect(navCounts(t.db, opts()).programsChanged).toBe(1);

    t.db.prepare("UPDATE sources SET last_error = '404' WHERE name LIKE 'KAUST%'").run();
    t.db.prepare("UPDATE sources SET consecutive_empty = 3 WHERE name LIKE 'IAESTE%'").run();
    t.db.prepare("UPDATE sources SET consecutive_empty = 2 WHERE name LIKE 'Google%'").run();
    expect(navCounts(t.db, opts()).sourcesBroken).toBe(2);
  });
});

describe('sidebar badges', () => {
  it('only what needs attention, in the design tones, with spoken labels', () => {
    expect(navBadges(null)).toEqual({});
    const b = navBadges({
      newOpportunities: 12,
      deadlinesDue: 3,
      followupsDue: 1,
      programsChanged: 0,
      sourcesBroken: 2,
    });
    expect(b).toEqual({
      opportunities: { text: '12 new', tone: 'accent', label: '12 new opportunities' },
      deadlines: { text: '3 due', tone: 'amber', label: '3 items due soon' },
      pipeline: { text: '1', tone: 'amber', label: '1 follow-up due' },
      sources: { text: '2', tone: 'red', label: '2 sources look broken' },
    });
    expect(
      navBadges({
        newOpportunities: 0,
        deadlinesDue: 0,
        followupsDue: 0,
        programsChanged: 1,
        sourcesBroken: 0,
      }),
    ).toEqual({
      programs: { text: '1', tone: 'gray', label: '1 program page changed' },
    });
  });
});
