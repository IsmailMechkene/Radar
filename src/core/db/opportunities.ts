import type Database from 'better-sqlite3-multiple-ciphers';
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

// On conflict, each column's refreshed value. Bare names read the stored row: SQLite evaluates
// every SET expression against the row as it was.
const REFRESHED: Readonly<Record<string, string>> = {
  org: 'excluded.org',
  title: 'excluded.title',
  location: 'COALESCE(excluded.location, location)',
  remote_type:
    "CASE WHEN excluded.remote_type = 'unknown' THEN remote_type ELSE excluded.remote_type END",
  opportunity_type: 'excluded.opportunity_type',
  language: "CASE WHEN excluded.language = 'unknown' THEN language ELSE excluded.language END",
  url: 'excluded.url',
  apply_url: 'COALESCE(excluded.apply_url, apply_url)',
  description: 'COALESCE(excluded.description, description)',
  posted_at: 'COALESCE(excluded.posted_at, posted_at)',
  deadline_at: 'COALESCE(excluded.deadline_at, deadline_at)',
  deadline_status:
    "CASE WHEN excluded.deadline_status = 'unknown' THEN deadline_status ELSE excluded.deadline_status END",
  deadline_text: 'COALESCE(excluded.deadline_text, deadline_text)',
  eligibility_notes: 'COALESCE(excluded.eligibility_notes, eligibility_notes)',
};
/** True when the refresh changes content, or reopens a closed posting: the passes look again. */
const NEEDS_PASS = [
  'closed_at IS NOT NULL',
  ...Object.entries(REFRESHED).map(([col, value]) => `(${col} IS NOT ${value})`),
].join(' OR ');

const UPSERT_SQL = `INSERT INTO opportunities (
     dedupe_key, source_id, org, title, location, remote_type, opportunity_type, language,
     url, apply_url, description, posted_at, deadline_at, deadline_status, deadline_text,
     eligibility_notes, first_seen_at, last_seen_at
   ) VALUES (
     @dedupe_key, @source_id, @org, @title, @location, @remote_type, @opportunity_type, @language,
     @url, @apply_url, @description, @posted_at, @deadline_at, @deadline_status, @deadline_text,
     @eligibility_notes, @seen_at, @seen_at
   )
   ON CONFLICT (dedupe_key) DO UPDATE SET
     ${Object.entries(REFRESHED)
       .map(([col, value]) => `${col} = ${value}`)
       .join(', ')},
     revision     = revision + (${NEEDS_PASS}),
     last_seen_at = excluded.last_seen_at,
     closed_at    = NULL
   RETURNING id`;

type Store = (input: OpportunityInput, now: Date) => { id: number; inserted: boolean };

// A scan stores thousands of postings: compile the statements once per connection.
const stores = new WeakMap<Database.Database, Store>();

function storeFor(db: Database.Database): Store {
  const cached = stores.get(db);
  if (cached) return cached;
  const exists = db.prepare('SELECT 1 FROM opportunities WHERE dedupe_key = ?').pluck();
  const upsert = db.prepare(UPSERT_SQL).pluck();
  const link = db.prepare(
    `INSERT INTO opportunity_sources (opportunity_id, source_id, url, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (opportunity_id, source_id, url) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  );
  const store = db.transaction((input: OpportunityInput, now: Date) => {
    const o = opportunityInputSchema.parse(input);
    const seenAt = now.toISOString();
    const inserted = exists.get(o.dedupe_key) === undefined;
    const id = upsert.get({ ...o, seen_at: seenAt }) as number;
    link.run(id, o.source_id, o.url, seenAt, seenAt);
    return { id, inserted };
  });
  stores.set(db, store);
  return store;
}

/**
 * Inserts or refreshes one opportunity by dedupe_key and records the source link. Returns only
 * the id (the scanner's path: no row is read back).
 * On update, known values are not overwritten by nulls, first_seen_at is kept,
 * last_seen_at moves forward and closed_at is cleared. `revision` moves when the content changed
 * or the posting reopens, so the after-scan passes pick it up.
 */
export function storeOpportunity(
  db: Database.Database,
  input: OpportunityInput,
  now: Date,
): { id: number; inserted: boolean } {
  return storeFor(db)(input, now);
}

/** storeOpportunity, returning the stored row. */
export function upsertOpportunity(
  db: Database.Database,
  input: OpportunityInput,
  now: Date,
): UpsertResult {
  const { id, inserted } = storeOpportunity(db, input, now);
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  return { opportunity: opportunityRowSchema.parse(row), inserted };
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

/**
 * The Opportunities list query. Reads only columns held by the opportunities_list covering index
 * (migration 14), never the breakdown JSON or the description. INDEXED BY because the app never
 * runs ANALYZE, so the planner may otherwise pick another index and sort. In SQLite, DESC already
 * puts NULL scores last. Source counts come from one grouped scan.
 */
export const LIST_SQL = `SELECT o.id, o.org, o.title, o.location, o.remote_type, o.opportunity_type, o.url,
       o.apply_url, o.posted_at, o.deadline_at, o.deadline_status, o.score, o.verdict,
       o.score_summary AS summary, o.starred, o.first_seen_at,
       s.name AS source_name, s.kind AS source_kind, s.access_method AS source_access_method,
       COALESCE(c.n, 0) AS source_count
  FROM opportunities o INDEXED BY opportunities_list
  JOIN sources s ON s.id = o.source_id
  LEFT JOIN (SELECT opportunity_id, COUNT(*) AS n FROM opportunity_sources
              GROUP BY opportunity_id) c ON c.opportunity_id = o.id
 WHERE o.dismissed_at IS NULL AND o.closed_at IS NULL
 ORDER BY o.score DESC, o.first_seen_at DESC`;

/** Open (not dismissed) opportunities with their primary source and how many sources list them. */
export function listOpportunityItems(db: Database.Database): OpportunityListItem[] {
  return db
    .prepare(LIST_SQL)
    .all()
    .map((row) => opportunityListItemSchema.parse(row));
}

/**
 * Ids of open postings where every word of `query` appears in the title, organization,
 * location, source name or description (case-insensitive, Unicode). Runs here so the list sent
 * to the page can leave out the descriptions (most of its size).
 */
export function searchOpportunityIds(db: Database.Database, query: string): number[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT o.id, o.title, o.org, o.location, s.name, o.description
         FROM opportunities o JOIN sources s ON s.id = o.source_id
        WHERE o.dismissed_at IS NULL AND o.closed_at IS NULL`,
    )
    .raw()
    .iterate() as Iterable<[number, string, string, string | null, string, string | null]>;
  const ids: number[] = [];
  for (const [id, ...fields] of rows) {
    const hay = fields.filter(Boolean).join(' ').toLowerCase();
    if (words.every((w) => hay.includes(w))) ids.push(id);
  }
  return ids;
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

/** Removes score and verdict (programs are not scored); sets the eligibility notes. */
export function clearScore(
  db: Database.Database,
  id: number,
  eligibilityNotes: string | null,
): void {
  const changed = db
    .prepare(
      `UPDATE opportunities SET score = NULL, verdict = NULL, score_breakdown_json = NULL,
         score_summary = NULL, eligibility_notes = ? WHERE id = ?`,
    )
    .run(eligibilityNotes, id).changes;
  if (changed === 0) throw new Error(`No opportunity with id ${id}`);
}

/** Stores a rules-engine result. Verdict and breakdown are validated before writing. */
export function applyScore(
  db: Database.Database,
  id: number,
  result: {
    score: number;
    verdict: string;
    breakdown: ScoreBreakdown;
    /** When given (null included), replaces the eligibility notes; omitted keeps them. */
    eligibilityNotes?: string | null;
  },
): void {
  const verdict = verdictSchema.parse(result.verdict);
  const breakdown = scoreBreakdownSchema.parse(result.breakdown);
  if (!Number.isFinite(result.score)) throw new Error('Score must be a finite number');
  const changed =
    result.eligibilityNotes === undefined
      ? db
          .prepare(
            `UPDATE opportunities SET score = ?, verdict = ?, score_breakdown_json = ?,
               score_summary = ? WHERE id = ?`,
          )
          .run(result.score, verdict, JSON.stringify(breakdown), breakdown.summary, id).changes
      : db
          .prepare(
            `UPDATE opportunities SET score = ?, verdict = ?, score_breakdown_json = ?,
               score_summary = ?, eligibility_notes = ? WHERE id = ?`,
          )
          .run(
            result.score,
            verdict,
            JSON.stringify(breakdown),
            breakdown.summary,
            result.eligibilityNotes,
            id,
          ).changes;
  if (changed === 0) throw new Error(`No opportunity with id ${id}`);
}
