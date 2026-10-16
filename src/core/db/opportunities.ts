import type Database from 'better-sqlite3';
import {
  opportunityInputSchema,
  opportunityListItemSchema,
  opportunityRowSchema,
  opportunitySourceLinkSchema,
  opportunitySourceRowSchema,
  parseBreakdown,
  scoreBreakdownSchema,
  verdictSchema,
  type OpportunityDetail,
  type OpportunityInput,
  type OpportunityListItem,
  type OpportunityRow,
  type OpportunitySourceRow,
  type ScoreBreakdown,
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
           url, apply_url, description, posted_at, deadline_at, deadline_status, deadline_text,
           eligibility_notes, first_seen_at, last_seen_at
         ) VALUES (
           @dedupe_key, @source_id, @org, @title, @location, @remote_type, @opportunity_type, @language,
           @url, @apply_url, @description, @posted_at, @deadline_at, @deadline_status, @deadline_text,
           @eligibility_notes, @seen_at, @seen_at
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
           deadline_text     = COALESCE(excluded.deadline_text, deadline_text),
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

/** Open (not dismissed) opportunities with their primary source and how many sources list them. */
export function listOpportunityItems(db: Database.Database): OpportunityListItem[] {
  return db
    .prepare(
      `SELECT o.id, o.org, o.title, o.location, o.remote_type, o.opportunity_type, o.url, o.apply_url,
              o.description, o.posted_at, o.deadline_at, o.deadline_status, o.score, o.verdict,
              o.score_breakdown_json, o.starred, o.first_seen_at,
              s.name AS source_name, s.kind AS source_kind, s.access_method AS source_access_method,
              (SELECT COUNT(*) FROM opportunity_sources os WHERE os.opportunity_id = o.id) AS source_count
         FROM opportunities o
         JOIN sources s ON s.id = o.source_id
        WHERE o.dismissed_at IS NULL AND o.closed_at IS NULL
        ORDER BY o.score DESC NULLS LAST, o.first_seen_at DESC`,
    )
    .all()
    .map((row) => opportunityListItemSchema.parse(row));
}

export function getOpportunityDetail(
  db: Database.Database,
  id: number,
): OpportunityDetail | undefined {
  const raw = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  if (raw === undefined) return undefined;
  const { score_breakdown_json, ...row } = opportunityRowSchema.parse(raw);
  const sources = db
    .prepare(
      `SELECT os.source_id, s.name, s.access_method, os.url, os.first_seen_at
         FROM opportunity_sources os
         JOIN sources s ON s.id = os.source_id
        WHERE os.opportunity_id = ?
        ORDER BY os.first_seen_at, s.name`,
    )
    .all(id)
    .map((r) => opportunitySourceLinkSchema.parse(r));
  return { ...row, breakdown: parseBreakdown(score_breakdown_json), sources };
}

function idList(ids: readonly number[]): string {
  if (ids.length === 0) throw new Error('Expected at least one opportunity id');
  if (!ids.every((id) => Number.isInteger(id) && id > 0)) throw new Error('Invalid opportunity id');
  return ids.map(() => '?').join(', ');
}

/** Returns how many rows changed. */
export function setStarred(
  db: Database.Database,
  ids: readonly number[],
  starred: boolean,
): number {
  return db
    .prepare(`UPDATE opportunities SET starred = ? WHERE id IN (${idList(ids)})`)
    .run(starred ? 1 : 0, ...ids).changes;
}

/** Hides opportunities from every view. Reversible with `restoreOpportunities`. */
export function dismissOpportunities(
  db: Database.Database,
  ids: readonly number[],
  now: Date,
): number {
  return db
    .prepare(
      `UPDATE opportunities SET dismissed_at = ? WHERE dismissed_at IS NULL AND id IN (${idList(ids)})`,
    )
    .run(now.toISOString(), ...ids).changes;
}

export function restoreOpportunities(db: Database.Database, ids: readonly number[]): number {
  return db
    .prepare(`UPDATE opportunities SET dismissed_at = NULL WHERE id IN (${idList(ids)})`)
    .run(...ids).changes;
}

/** Stores a rules-engine result. Verdict and breakdown are validated before writing. */
export function applyScore(
  db: Database.Database,
  id: number,
  result: { score: number; verdict: string; breakdown: ScoreBreakdown },
): void {
  const verdict = verdictSchema.parse(result.verdict);
  const breakdown = scoreBreakdownSchema.parse(result.breakdown);
  if (!Number.isFinite(result.score)) throw new Error('Score must be a finite number');
  const changed = db
    .prepare(
      'UPDATE opportunities SET score = ?, verdict = ?, score_breakdown_json = ? WHERE id = ?',
    )
    .run(result.score, verdict, JSON.stringify(breakdown), id).changes;
  if (changed === 0) throw new Error(`No opportunity with id ${id}`);
}
