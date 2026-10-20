// Performance review regressions: what crosses IPC stays small, and the expensive paths only
// touch the rows they need.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../src/core/chunks';
import { migrate } from '../src/core/db/migrate';
import { migrations } from '../src/core/db/migrations';
import {
  applyScore,
  dismissOpportunities,
  LIST_SQL,
  storeOpportunity,
  listOpportunityItems,
  searchOpportunityIds,
  setStarred,
  upsertOpportunity,
} from '../src/core/db/opportunities';
import { insertSource } from '../src/core/db/sources';
import { listDeadlines } from '../src/core/deadlines/list';
import { extractDeadlines, extractDeadlinesAsync } from '../src/core/deadlines/postings';
import { compileRules } from '../src/core/rules/engine';
import { profileFromSettings } from '../src/core/rules/profile';
import { rescoreAll, rescoreAllAsync } from '../src/core/rules/rescore';
import { parseRules } from '../src/core/rules/schema';
import { DEFAULT_SETTINGS } from '../src/core/settings/schema';
import { seedDefaultSettings } from '../src/core/settings/store';
import { runPass, runPassAsync } from '../src/core/passes';
import { tempDb } from './helpers';

const NOW = new Date('2026-10-16T08:00:00.000Z');

describe('opportunity list and search', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  function add(title: string, description: string, location = 'Paris') {
    const src = insertSource(
      t.db,
      { kind: 'ashby', name: `Board ${title}`, access_method: 'api' },
      NOW,
    );
    return upsertOpportunity(
      t.db,
      {
        dedupe_key: `acme|${title}|`,
        source_id: src.id,
        org: 'Acme',
        title,
        location,
        opportunity_type: 'internship',
        url: `https://acme.test/${encodeURIComponent(title)}`,
        description,
      },
      NOW,
    ).opportunity.id;
  }

  it('the list carries no descriptions (most of its size)', () => {
    add('ML Intern', 'x'.repeat(5000));
    const [item] = listOpportunityItems(t.db);
    expect(item).not.toHaveProperty('description');
    expect(JSON.stringify(item).length).toBeLessThan(1000);
  });

  it('search: every word, across fields and the description, case-insensitive (Unicode)', () => {
    const ml = add('ML Intern', 'You will work on PyTorch models at the École.');
    const go = add('Backend Intern', 'Go and Rust services.', 'Berlin');
    const gone = add('Rust Intern', 'Rust.');
    dismissOpportunities(t.db, [gone], NOW);
    expect(searchOpportunityIds(t.db, 'pytorch')).toEqual([ml]);
    expect(searchOpportunityIds(t.db, 'ÉCOLE intern')).toEqual([ml]);
    expect(searchOpportunityIds(t.db, 'rust berlin')).toEqual([go]); // description + location
    expect(searchOpportunityIds(t.db, 'rust tokyo')).toEqual([]);
    expect(searchOpportunityIds(t.db, 'board backend')).toEqual([go]); // source name
    expect(searchOpportunityIds(t.db, '   ')).toEqual([]);
  });
});

describe('deadline queries', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  const DAY = 86_400_000;
  function posting(title: string, inDays: number, starred = false) {
    const src = insertSource(t.db, { kind: 'ashby', name: title, access_method: 'api' }, NOW);
    const id = upsertOpportunity(
      t.db,
      {
        dedupe_key: title,
        source_id: src.id,
        org: 'Acme',
        title,
        opportunity_type: 'internship',
        url: `https://acme.test/${title}`,
      },
      NOW,
    ).opportunity.id;
    t.db
      .prepare(
        "UPDATE opportunities SET deadline_at = ?, deadline_status = 'confirmed' WHERE id = ?",
      )
      .run(new Date(NOW.getTime() + inDays * DAY).toISOString(), id);
    if (starred) setStarred(t.db, [id], true);
    return id;
  }
  const titles = (q: Parameters<typeof listDeadlines>[2]) =>
    listDeadlines(t.db, NOW, q).events.map((e) => e.title);

  it('the window and the tracked filter are applied in SQL', () => {
    posting('long gone', -60);
    posting('last week', -7, true);
    posting('soon', 3);
    posting('soon starred', 5, true);
    posting('far', 90, true);
    expect(titles({})).toEqual(['long gone', 'last week', 'soon', 'soon starred', 'far']);
    expect(titles({ from: new Date(NOW.getTime() - 31 * DAY) })).toEqual([
      'last week',
      'soon',
      'soon starred',
      'far',
    ]);
    expect(
      titles({
        trackedOnly: true,
        from: new Date(NOW.getTime() - 8 * DAY),
        to: new Date(NOW.getTime() + 16 * DAY),
      }),
    ).toEqual(['last week', 'soon starred']);
  });
});

describe('chunked re-scoring and deadline reading', () => {
  let t: ReturnType<typeof tempDb>;
  const rules = compileRules(
    parseRules(JSON.parse(readFileSync(join(__dirname, '..', 'seeds/rules.json'), 'utf8'))),
  );
  const profile = profileFromSettings(DEFAULT_SETTINGS);
  const N = CHUNK_SIZE * 2 + 1; // three chunks, the last one a single row

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    const src = insertSource(t.db, { kind: 'ashby', name: 'Board', access_method: 'api' }, NOW);
    t.db.transaction(() => {
      for (let i = 0; i < N; i++) {
        upsertOpportunity(
          t.db,
          {
            dedupe_key: `k${i}`,
            source_id: src.id,
            org: 'Acme',
            title: i % 2 ? 'Software Engineering Intern' : 'Sales Manager',
            location: 'Paris',
            opportunity_type: i % 2 ? 'internship' : 'fulltime',
            url: `https://acme.test/${i}`,
            description:
              i % 3
                ? 'Apply by 30 November 2026.'
                : 'Applications are reviewed on a rolling basis.',
          },
          NOW,
        );
      }
    })();
  });
  afterEach(() => t.cleanup());

  const snapshot = () =>
    t.db
      .prepare(
        'SELECT id, score, verdict, deadline_at, deadline_status FROM opportunities ORDER BY id',
      )
      .all();

  it('every row is covered, and the async pass matches the sync one', async () => {
    const sync = { deadlines: extractDeadlines(t.db, 'Europe/Paris') };
    const score = rescoreAll(t.db, rules, profile, NOW);
    const after = snapshot();
    expect(sync.deadlines.checked).toBe(N);
    expect(score.scored).toBe(N);
    expect(
      t.db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE score IS NULL').get(),
    ).toEqual({ n: 0 });

    t.db.prepare('UPDATE opportunities SET score = NULL, verdict = NULL, deadline_at = NULL').run();
    let pauses = 0;
    const pause = async () => {
      pauses += 1;
    };
    expect(await extractDeadlinesAsync(t.db, 'Europe/Paris', pause)).toEqual(sync.deadlines);
    expect(await rescoreAllAsync(t.db, rules, profile, NOW, pause)).toEqual(score);
    expect(pauses).toBe(6); // after each of the three chunks, for both passes
    expect(snapshot()).toEqual(after);
  });

  it('the async pass gives other work a turn between chunks', async () => {
    const order: string[] = [];
    const pass = rescoreAllAsync(t.db, rules, profile, NOW, () =>
      new Promise<void>((resolve) => setImmediate(resolve)).then(() => {
        order.push('chunk');
      }),
    );
    setImmediate(() => order.push('other'));
    await pass;
    expect(order.indexOf('other')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('other')).toBeLessThan(order.length - 1);
  });
});

describe('incremental passes after a scan', () => {
  let t: ReturnType<typeof tempDb>;
  const raw = parseRules(
    JSON.parse(readFileSync(join(__dirname, '..', 'seeds/rules.json'), 'utf8')),
  );
  const rules = compileRules(raw);
  const profile = profileFromSettings(DEFAULT_SETTINGS);
  const TZ = 'Europe/Paris';
  let source = 0;

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    source = insertSource(t.db, { kind: 'ashby', name: 'Board', access_method: 'api' }, NOW).id;
  });
  afterEach(() => t.cleanup());

  const store = (i: number, description: string, at = NOW) =>
    storeOpportunity(
      t.db,
      {
        dedupe_key: `k${i}`,
        source_id: source,
        org: 'Acme',
        title: 'Software Engineering Intern',
        location: 'Paris',
        opportunity_type: 'internship',
        url: `https://acme.test/${i}`,
        description,
      },
      at,
    );
  const pending = () =>
    t.db
      .prepare('SELECT id FROM opportunities WHERE scored_revision < revision ORDER BY id')
      .pluck()
      .all();
  const passes = (scope: 'all' | 'changed') => ({
    deadlines: extractDeadlines(t.db, TZ, scope).checked,
    scored: rescoreAll(t.db, rules, profile, NOW, scope).scored,
  });

  it('only new or changed postings are processed after a scan', () => {
    const ids = [1, 2, 3].map((i) => store(i, 'Python.').id);
    expect(pending()).toEqual(ids);
    expect(passes('changed')).toEqual({ deadlines: 3, scored: 3 });
    expect(pending()).toEqual([]);

    // The next scan sees the same postings: nothing to do.
    const later = new Date(NOW.getTime() + 3_600_000);
    [1, 2, 3].forEach((i) => store(i, 'Python.', later));
    expect(pending()).toEqual([]);
    expect(passes('changed')).toEqual({ deadlines: 0, scored: 0 });

    // One edited description, one new posting.
    store(2, 'Python. Apply by 30 November 2026.', later);
    const added = store(4, 'Go.', later).id;
    expect(pending()).toEqual([ids[1], added]);
    expect(passes('changed')).toEqual({ deadlines: 2, scored: 2 });
    expect(
      t.db.prepare('SELECT deadline_status FROM opportunities WHERE id = ?').pluck().get(ids[1]),
    ).toBe('confirmed');
    // A full pass still covers every open posting.
    expect(passes('all')).toEqual({ deadlines: 4, scored: 4 });
  });

  it('closed postings are skipped, and a reopened one is processed again', () => {
    store(1, 'Python.');
    const closed = store(2, 'Python.').id;
    passes('all');
    t.db
      .prepare('UPDATE opportunities SET closed_at = ? WHERE id = ?')
      .run(NOW.toISOString(), closed);
    expect(passes('all')).toEqual({ deadlines: 1, scored: 1 });

    store(2, 'Python.', new Date(NOW.getTime() + 3_600_000)); // listed again
    expect(pending()).toEqual([closed]);
    expect(passes('changed')).toEqual({ deadlines: 1, scored: 1 });
  });

  it('a row changed after it was read is not written and stays pending', () => {
    const id = store(1, 'Python.').id;
    const read = t.db.prepare('SELECT revision FROM opportunities WHERE id = ?').pluck().get(id);
    store(1, 'Python and Go.'); // what a scan on the main connection does meanwhile
    // The worker's write for the revision it read:
    const changes = t.db
      .prepare('UPDATE opportunities SET scored_revision = revision WHERE id = ? AND revision = ?')
      .run(id, read).changes;
    expect(changes).toBe(0);
    expect(pending()).toEqual([id]);
  });

  it('runPass (worker) and runPassAsync (fallback) give the same results', async () => {
    seedDefaultSettings(t.db);
    [1, 2, 3].forEach((i) => store(i, i === 2 ? 'Apply by 30 November 2026.' : 'Python.'));
    const job = { kind: 'rescore', scope: 'all', rules: raw, now: NOW.toISOString() } as const;
    const sync = [runPass(t.db, { kind: 'deadlines', scope: 'all' }), runPass(t.db, job)];
    const pause = async () => {};
    const async = [
      await runPassAsync(t.db, { kind: 'deadlines', scope: 'all' }, pause),
      await runPassAsync(t.db, job, pause),
    ];
    expect(async).toEqual(sync);
    expect(sync[1]).toMatchObject({ kind: 'rescore', result: { scored: 3 } });
  });
});

describe('opportunities list query', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
  });
  afterEach(() => t.cleanup());

  const breakdown = (summary: string) => ({ version: 1 as const, summary, signals: [] });

  function add(i: number, source: number) {
    return storeOpportunity(
      t.db,
      {
        dedupe_key: `k${i}`,
        source_id: source,
        org: 'Acme',
        title: `Intern ${i}`,
        opportunity_type: 'internship',
        url: `https://acme.test/${i}`,
      },
      NOW,
    ).id;
  }

  it('migration 14 copies each stored summary into its own column', () => {
    migrate(t.db, () => NOW, migrations.slice(0, 13));
    const src = insertSource(t.db, { kind: 'ashby', name: 'B', access_method: 'api' }, NOW).id;
    const id = add(1, src);
    t.db
      .prepare(
        "UPDATE opportunities SET score = 70, verdict = 'apply', score_breakdown_json = ? WHERE id = ?",
      )
      .run(JSON.stringify(breakdown('Strong match')), id);
    add(2, src); // never scored
    migrate(t.db, () => NOW);
    expect(listOpportunityItems(t.db).map((i) => i.summary)).toEqual(['Strong match', null]);
  });

  it('reads the summary column, counts sources, and puts unscored postings last', () => {
    migrate(t.db);
    const a = insertSource(t.db, { kind: 'ashby', name: 'A', access_method: 'api' }, NOW).id;
    const b = insertSource(t.db, { kind: 'lever', name: 'B', access_method: 'api' }, NOW).id;
    const unscored = add(1, a);
    const low = add(2, a);
    const high = add(3, a);
    applyScore(t.db, low, { score: 20, verdict: 'skip', breakdown: breakdown('Weak') });
    applyScore(t.db, high, { score: 80, verdict: 'apply', breakdown: breakdown('Strong') });
    // The same posting found on a second board.
    t.db
      .prepare(
        `INSERT INTO opportunity_sources (opportunity_id, source_id, url, first_seen_at, last_seen_at)
         VALUES (?, ?, 'https://b.test/3', ?, ?)`,
      )
      .run(high, b, NOW.toISOString(), NOW.toISOString());

    const list = listOpportunityItems(t.db);
    expect(list.map((i) => [i.id, i.summary, i.source_count])).toEqual([
      [high, 'Strong', 2],
      [low, 'Weak', 1],
      [unscored, null, 1],
    ]);
  });

  it('the list reads open postings from the covering index, without a sort', () => {
    migrate(t.db);
    const plan = t.db
      .prepare(`EXPLAIN QUERY PLAN ${LIST_SQL}`)
      .all()
      .map((r) => (r as { detail: string }).detail)
      .join(' | ');
    expect(plan).toContain('SCAN o USING COVERING INDEX opportunities_list');
    expect(plan).not.toContain('TEMP B-TREE FOR ORDER BY');
  });
});
