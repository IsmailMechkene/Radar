import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import {
  applyScore,
  dismissOpportunities,
  getOpportunityDetail,
  listOpportunityItems,
  restoreOpportunities,
  setStarred,
  upsertOpportunity,
} from '../src/core/db/opportunities';
import { addOpportunitiesToPipeline, removePipelineRows } from '../src/core/db/pipeline';
import { insertSource } from '../src/core/db/sources';
import { clearSampleData, loadSampleData, sampleFileSchema } from '../src/core/dev/sample';
import { tempDb } from './helpers';

const NOW = new Date('2026-10-16T08:00:00.000Z');
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/sample-opportunities.json'), 'utf8'),
) as unknown;

describe('opportunity queries', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  function seedOne() {
    const src = insertSource(
      t.db,
      { kind: 'greenhouse', name: 'Greenhouse', access_method: 'api' },
      NOW,
    );
    const { opportunity } = upsertOpportunity(
      t.db,
      {
        dedupe_key: 'acme|ml intern|paris',
        source_id: src.id,
        org: 'Acme',
        title: 'ML Intern',
        location: 'Paris',
        opportunity_type: 'internship',
        url: 'https://example.com/1',
        deadline_text: 'Apply by 31 March 2027.',
      },
      NOW,
    );
    return opportunity.id;
  }

  it('lists unscored items and stores the deadline sentence', () => {
    const id = seedOne();
    const [item] = listOpportunityItems(t.db);
    expect(item).toMatchObject({ id, score: null, verdict: null, summary: null, starred: false });
    expect(getOpportunityDetail(t.db, id)?.deadline_text).toBe('Apply by 31 March 2027.');
  });

  it('applies a validated score and exposes the breakdown', () => {
    const id = seedOne();
    applyScore(t.db, id, {
      score: 70,
      verdict: 'apply',
      breakdown: {
        version: 1,
        summary: 'ML title',
        signals: [{ id: 'role', label: 'Role match', detail: 'ML', points: 70 }],
      },
    });
    expect(listOpportunityItems(t.db)[0]?.summary).toBe('ML title');
    expect(getOpportunityDetail(t.db, id)?.breakdown?.signals).toHaveLength(1);
    expect(() =>
      applyScore(t.db, id, {
        score: 70,
        verdict: 'great',
        breakdown: { version: 1, summary: '', signals: [] },
      }),
    ).toThrow();
  });

  it('a malformed stored breakdown is an error, not silently empty', () => {
    const id = seedOne();
    t.db
      .prepare('UPDATE opportunities SET score_breakdown_json = \'{"oops":1}\' WHERE id = ?')
      .run(id);
    expect(() => listOpportunityItems(t.db)).toThrow();
  });

  it('stars, dismisses and restores', () => {
    const id = seedOne();
    expect(setStarred(t.db, [id], true)).toBe(1);
    expect(listOpportunityItems(t.db)[0]?.starred).toBe(true);
    expect(dismissOpportunities(t.db, [id], NOW)).toBe(1);
    expect(dismissOpportunities(t.db, [id], NOW)).toBe(0);
    expect(listOpportunityItems(t.db)).toHaveLength(0);
    expect(restoreOpportunities(t.db, [id])).toBe(1);
    expect(listOpportunityItems(t.db)).toHaveLength(1);
    expect(() => setStarred(t.db, [], true)).toThrow();
  });

  it('adds to the pipeline once and can undo', () => {
    const id = seedOne();
    const first = addOpportunitiesToPipeline(t.db, [id], NOW);
    expect(first.added).toHaveLength(1);
    expect(addOpportunitiesToPipeline(t.db, [id], NOW)).toEqual({ added: [], skipped: 1 });
    expect(removePipelineRows(t.db, first.added)).toBe(1);
    expect(() => addOpportunitiesToPipeline(t.db, [12345], NOW)).toThrow(/No opportunity/);
  });
});

describe('dev sample data', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  it('the fixture is valid and every score equals the sum of its signals', () => {
    const file = sampleFileSchema.parse(fixture);
    for (const item of file.items) {
      expect(
        item.signals.reduce((s, x) => s + x.points, 0),
        item.key,
      ).toBe(item.score);
    }
  });

  it('loads relative to the clock, merges multi-source items and clears completely', () => {
    expect(loadSampleData(t.db, fixture, NOW)).toBe(17);
    expect(loadSampleData(t.db, fixture, NOW)).toBe(17); // replaces, never duplicates
    const items = listOpportunityItems(t.db);
    expect(items).toHaveLength(17);

    const hf = items.find((i) => i.title.startsWith('Machine Learning Engineer Intern'))!;
    expect(hf.source_count).toBe(3);
    expect(hf.first_seen_at).toBe('2026-10-16T02:00:00.000Z'); // 6 hours before NOW
    expect(hf.deadline_at).toBe('2026-10-25T21:59:00.000Z'); // 9 days later, end of day CET
    expect(getOpportunityDetail(t.db, hf.id)?.sources.map((s) => s.name)).toEqual([
      'Greenhouse',
      'LinkedIn alert',
      'Welcome to the Jungle',
    ]);

    addOpportunitiesToPipeline(t.db, [hf.id], NOW);
    expect(clearSampleData(t.db)).toBe(17);
    expect(listOpportunityItems(t.db)).toHaveLength(0);
    expect(t.db.prepare('SELECT COUNT(*) FROM sources').pluck().get()).toBe(0);
    expect(t.db.prepare('SELECT COUNT(*) FROM pipeline').pluck().get()).toBe(0);
  });

  it('rejects an invalid fixture without writing anything', () => {
    expect(() => loadSampleData(t.db, { version: 1, sources: [], items: [{}] }, NOW)).toThrow();
    expect(t.db.prepare('SELECT COUNT(*) FROM sources').pluck().get()).toBe(0);
  });
});
