// Performance review regressions: what crosses IPC stays small, and the expensive paths only
// touch the rows they need.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../src/core/chunks';
import { migrate } from '../src/core/db/migrate';
import {
  dismissOpportunities,
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
