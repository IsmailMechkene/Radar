// Re-scores stored opportunities with the current rules and profile (after scans, at startup,
// and when scoring settings change). Development sample rows keep their recorded scores.
import type Database from 'better-sqlite3';
import { applyScore } from '../db/opportunities';
import { opportunityRowSchema } from '../db/schemas';
import { scoreOpportunity, type CompiledRules, type ScoringProfile } from './engine';

export interface RescoreResult {
  scored: number;
  byVerdict: Record<'apply' | 'maybe' | 'needs_review' | 'skip', number>;
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
    .map((r) => opportunityRowSchema.parse(r));
  const byVerdict = { apply: 0, maybe: 0, needs_review: 0, skip: 0 };
  db.transaction(() => {
    for (const row of rows) {
      const r = scoreOpportunity(row, rules, profile, now);
      applyScore(db, row.id, r);
      byVerdict[r.verdict] += 1;
    }
  })();
  return { scored: rows.length, byVerdict };
}
