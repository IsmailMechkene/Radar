import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import {
  getOpportunityByDedupeKey,
  listOpportunitySources,
  upsertOpportunity,
} from '../src/core/db/opportunities';
import type { OpportunityInput } from '../src/core/db/schemas';
import { insertSource } from '../src/core/db/sources';
import { tempDb } from './helpers';

const T1 = new Date('2026-10-16T08:00:00.000Z');
const T2 = new Date('2026-10-16T14:00:00.000Z');

describe('upsertOpportunity', () => {
  let t: ReturnType<typeof tempDb>;
  let sourceA: number;
  let sourceB: number;
  let posting: OpportunityInput;

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    sourceA = insertSource(
      t.db,
      { kind: 'greenhouse', name: 'Acme (Greenhouse)', access_method: 'api' },
      T1,
    ).id;
    sourceB = insertSource(
      t.db,
      { kind: 'manual', name: 'Manual', access_method: 'manual' },
      T1,
    ).id;
    posting = {
      dedupe_key: 'acme|ml engineer intern|paris',
      source_id: sourceA,
      org: 'Acme',
      title: 'ML Engineer Intern',
      location: 'Paris',
      opportunity_type: 'internship',
      url: 'https://boards.example.com/acme/123',
      deadline_at: '2027-01-31T23:59:00.000Z',
      deadline_status: 'confirmed',
    };
  });
  afterEach(() => t.cleanup());

  it('upserting the same opportunity twice gives one row', () => {
    const first = upsertOpportunity(t.db, posting, T1);
    const second = upsertOpportunity(t.db, posting, T2);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.opportunity.id).toBe(first.opportunity.id);
    expect(t.db.prepare('SELECT COUNT(*) FROM opportunities').pluck().get()).toBe(1);
    expect(t.db.prepare('SELECT COUNT(*) FROM opportunity_sources').pluck().get()).toBe(1);

    const row = getOpportunityByDedupeKey(t.db, posting.dedupe_key);
    expect(row?.first_seen_at).toBe(T1.toISOString());
    expect(row?.last_seen_at).toBe(T2.toISOString());
  });

  it('keeps every source link on one merged opportunity and does not erase known fields', () => {
    const { opportunity } = upsertOpportunity(t.db, posting, T1);
    upsertOpportunity(
      t.db,
      {
        ...posting,
        source_id: sourceB,
        url: 'https://acme.example.com/careers/ml-intern',
        deadline_at: null,
        deadline_status: 'unknown',
      },
      T2,
    );

    expect(t.db.prepare('SELECT COUNT(*) FROM opportunities').pluck().get()).toBe(1);
    expect(listOpportunitySources(t.db, opportunity.id).map((l) => l.source_id)).toEqual([
      sourceA,
      sourceB,
    ]);
    const row = getOpportunityByDedupeKey(t.db, posting.dedupe_key);
    expect(row?.deadline_at).toBe('2027-01-31T23:59:00.000Z');
    expect(row?.deadline_status).toBe('confirmed');
    expect(row?.source_id).toBe(sourceA);
  });

  it('rejects invalid input before touching the DB', () => {
    expect(() =>
      upsertOpportunity(t.db, { ...posting, url: 'not a url', posted_at: '2026-10-16 10:00' }, T1),
    ).toThrow();
    expect(t.db.prepare('SELECT COUNT(*) FROM opportunities').pluck().get()).toBe(0);
  });
});
