import type Database from 'better-sqlite3';
import {
  opportunityInputSchema,
  opportunityRowSchema,
  opportunitySourceRowSchema,
  type OpportunityInput,
  type OpportunityRow,
  type OpportunitySourceRow,
} from './schemas';

export interface UpsertResult {
  opportunity: OpportunityRow;
  inserted: boolean;
}

/**
 * Inserts or refreshes one opportunity by dedupe_key and records the source link.
 * On update, known values are not overwritten by nulls, first_seen_at is kept,
 * last_seen_at moves forward and closed_at is cleared.
 */
export function upsertOpportunity(
  db: Database.Database,
  input: OpportunityInput,
  now: Date,
): UpsertResult {
  const o = opportunityInputSchema.parse(input);
  const seenAt = now.toISOString();

  return db.transaction((): UpsertResult => {
    const existed =
      db.prepare('SELECT 1 FROM opportunities WHERE dedupe_key = ?').get(o.dedupe_key) !==
      undefined;

    const row = db
      .prepare(
        `INSERT INTO opportunities (
           dedupe_key, source_id, org, title, location, remote_type, opportunity_type, language,
           url, apply_url, description, posted_at, deadline_at, deadline_status, eligibility_notes,
           first_seen_at, last_seen_at
         ) VALUES (
           @dedupe_key, @source_id, @org, @title, @location, @remote_type, @opportunity_type, @language,
           @url, @apply_url, @description, @posted_at, @deadline_at, @deadline_status, @eligibility_notes,
           @seen_at, @seen_at
         )
         ON CONFLICT (dedupe_key) DO UPDATE SET
           org               = excluded.org,
           title             = excluded.title,
           location          = COALESCE(excluded.location, location),
           remote_type       = CASE WHEN excluded.remote_type = 'unknown' THEN remote_type ELSE excluded.remote_type END,
           opportunity_type  = excluded.opportunity_type,
           language          = CASE WHEN excluded.language = 'unknown' THEN language ELSE excluded.language END,
           url               = excluded.url,
           apply_url         = COALESCE(excluded.apply_url, apply_url),
           description       = COALESCE(excluded.description, description),
           posted_at         = COALESCE(excluded.posted_at, posted_at),
           deadline_at       = COALESCE(excluded.deadline_at, deadline_at),
           deadline_status   = CASE WHEN excluded.deadline_status = 'unknown' THEN deadline_status ELSE excluded.deadline_status END,
           eligibility_notes = COALESCE(excluded.eligibility_notes, eligibility_notes),
           last_seen_at      = excluded.last_seen_at,
           closed_at         = NULL
         RETURNING *`,
      )
      .get({ ...o, seen_at: seenAt });
    const opportunity = opportunityRowSchema.parse(row);

    db.prepare(
      `INSERT INTO opportunity_sources (opportunity_id, source_id, url, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (opportunity_id, source_id, url) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    ).run(opportunity.id, o.source_id, o.url, seenAt, seenAt);

    return { opportunity, inserted: !existed };
  })();
}

export function getOpportunityByDedupeKey(
  db: Database.Database,
  dedupeKey: string,
): OpportunityRow | undefined {
  const row = db.prepare('SELECT * FROM opportunities WHERE dedupe_key = ?').get(dedupeKey);
  return row === undefined ? undefined : opportunityRowSchema.parse(row);
}

export function listOpportunitySources(
  db: Database.Database,
  opportunityId: number,
): OpportunitySourceRow[] {
  return db
    .prepare('SELECT * FROM opportunity_sources WHERE opportunity_id = ? ORDER BY source_id, url')
    .all(opportunityId)
    .map((row) => opportunitySourceRowSchema.parse(row));
}
