// Performance review regressions: what crosses IPC stays small, and the expensive paths only
// touch the rows they need.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import {
  dismissOpportunities,
  listOpportunityItems,
  searchOpportunityIds,
  upsertOpportunity,
} from '../src/core/db/opportunities';
import { insertSource } from '../src/core/db/sources';
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
