// Re-scores stored opportunities with the current rules and profile (after scans, at startup,
// and when scoring settings change). Development sample rows keep their recorded scores.
// Program postings are not scored: they are tracked on the Programs watchlist with their own
// status, so their score and verdict are cleared.
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { applyScore, clearScore } from '../db/opportunities';
import { opportunityRowSchema } from '../db/schemas';
import { scoreOpportunity, type CompiledRules, type ScoringProfile } from './engine';

export interface RescoreResult {
  scored: number;
  /** Program postings left unscored. */
  programs: number;
  byVerdict: Record<'apply' | 'maybe' | 'needs_review' | 'skip', number>;
}

const rowSchema = opportunityRowSchema.extend({ deadline_note: z.string().nullable() });

/** The eligibility line for a deadline the parser did not trust. */
export function deadlineNote(sentence: string | null, why: string | null): string | null {
  if (!why) return null;
  return `Deadline: ${sentence ? `“${sentence}”` : 'a date'} could not be read with confidence (${why}). Check the deadline`;
}

export function rescoreAll(
  db: Database.Database,
  rules: CompiledRules,
  profile: ScoringProfile,
  now: Date,
): RescoreResult {
  const rows = db
    .prepare(
      `SELECT o.* FROM opportunities o JOIN sources s ON s.id = o.source_id
        WHERE s.kind <> 'sample'`,
    )
    .all()
    .map((r) => rowSchema.parse(r));
  const byVerdict = { apply: 0, maybe: 0, needs_review: 0, skip: 0 };
  let programs = 0;
  db.transaction(() => {
    for (const row of rows) {
      const deadline = deadlineNote(row.deadline_text, row.deadline_note);
      if (row.opportunity_type === 'program') {
        clearScore(db, row.id, deadline);
        programs += 1;
        continue;
      }
      const r = scoreOpportunity(row, rules, profile, now);
      const notes = [r.eligibilityNotes, deadline].filter(Boolean).join('\n') || null;
      applyScore(db, row.id, { ...r, eligibilityNotes: notes });
      byVerdict[r.verdict] += 1;
    }
  })();
  return { scored: rows.length - programs, programs, byVerdict };
}
