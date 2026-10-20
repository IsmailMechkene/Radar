// Re-scores stored opportunities with the current rules and profile (after scans, at startup,
// and when scoring settings change). Development sample rows keep their recorded scores.
// Program postings are not scored: they are tracked on the Programs watchlist with their own
// status, so their score and verdict are cleared.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { drain, drainAsync, inChunks, scopeCondition, type PassScope } from '../chunks';
import { opportunityRowSchema, scoreBreakdownSchema, verdictSchema } from '../db/schemas';
import { scoreOpportunity, type CompiledRules, type ScoringProfile } from './engine';

export interface RescoreResult {
  scored: number;
  /** Program postings left unscored. */
  programs: number;
  byVerdict: Record<'apply' | 'maybe' | 'needs_review' | 'skip', number>;
}

const rowSchema = opportunityRowSchema.extend({
  deadline_note: z.string().nullable(),
  revision: z.int(),
});

/** The eligibility line for a deadline the parser did not trust. */
export function deadlineNote(sentence: string | null, why: string | null): string | null {
  if (!why) return null;
  return `Deadline: ${sentence ? `“${sentence}”` : 'a date'} could not be read with confidence (${why}). Check the deadline`;
}

/**
 * The re-score as chunks (see chunks.ts); `result` is filled in as they run. Each written row is
 * marked processed (scored_revision); a row a scan changed meanwhile is not written and stays
 * pending for the next pass.
 */
function rescoreChunks(
  db: Database.Database,
  rules: CompiledRules,
  profile: ScoringProfile,
  now: Date,
  result: RescoreResult,
  scope: PassScope,
) {
  const load = db.prepare(
    `SELECT o.* FROM opportunities o JOIN sources s ON s.id = o.source_id
      WHERE s.kind <> 'sample' AND ${scopeCondition(scope)} AND o.id > ? ORDER BY o.id LIMIT ?`,
  );
  const write = db.prepare(
    `UPDATE opportunities SET score = ?, verdict = ?, score_breakdown_json = ?, score_summary = ?,
       eligibility_notes = ?, scored_revision = revision WHERE id = ? AND revision = ?`,
  );
  return inChunks(
    db,
    (after, limit) => load.all(after, limit).map((r) => rowSchema.parse(r)),
    (rows) =>
      rows.map((row) => {
        const deadline = deadlineNote(row.deadline_text, row.deadline_note);
        if (row.opportunity_type === 'program') {
          result.programs += 1;
          return [null, null, null, null, deadline, row.id, row.revision] as const;
        }
        const r = scoreOpportunity(row, rules, profile, now);
        if (!Number.isFinite(r.score)) throw new Error('Score must be a finite number');
        const verdict = verdictSchema.parse(r.verdict);
        const breakdown = scoreBreakdownSchema.parse(r.breakdown);
        const notes = [r.eligibilityNotes, deadline].filter(Boolean).join('\n') || null;
        result.byVerdict[verdict] += 1;
        result.scored += 1;
        return [
          r.score,
          verdict,
          JSON.stringify(breakdown),
          breakdown.summary,
          notes,
          row.id,
          row.revision,
        ] as const;
      }),
    (values) => {
      for (const v of values) write.run(...v);
    },
  );
}

const emptyResult = (): RescoreResult => ({
  scored: 0,
  programs: 0,
  byVerdict: { apply: 0, maybe: 0, needs_review: 0, skip: 0 },
});

export function rescoreAll(
  db: Database.Database,
  rules: CompiledRules,
  profile: ScoringProfile,
  now: Date,
  scope: PassScope = 'all',
): RescoreResult {
  const result = emptyResult();
  drain(rescoreChunks(db, rules, profile, now, result, scope));
  return result;
}

/** Same as rescoreAll, giving the event loop a turn between chunks of postings (CHUNK_SIZE). */
export async function rescoreAllAsync(
  db: Database.Database,
  rules: CompiledRules,
  profile: ScoringProfile,
  now: Date,
  pause: () => Promise<void>,
  scope: PassScope = 'all',
): Promise<RescoreResult> {
  const result = emptyResult();
  await drainAsync(rescoreChunks(db, rules, profile, now, result, scope), pause);
  return result;
}
