// Sidebar counts. Each uses the same rule as its page, so a badge never disagrees with what the
// page shows: new opportunities since the last visit, Due soon, follow-ups due, program pages
// changed and not reviewed, sources that look broken.
import type Database from 'better-sqlite3';
import { followupDue, listPipeline } from './db/pipeline';
import { dueSoon } from './deadlines/due';
import { listDeadlines } from './deadlines/list';

export interface NavCounts {
  /** Open opportunities first seen after `newSince`. */
  newOpportunities: number;
  /** The Deadlines page's "Due soon" column. */
  deadlinesDue: number;
  /** Pipeline rows with a follow-up due. */
  followupsDue: number;
  /** Programs with a page change not reviewed yet. */
  programsChanged: number;
  /** Enabled sources whose last fetch failed, or that returned nothing 3 runs in a row. */
  sourcesBroken: number;
}

/** A source looks broken after this many empty runs in a row (SPEC section 8). */
export const BROKEN_AFTER_EMPTY_RUNS = 3;

export function navCounts(
  db: Database.Database,
  opts: { now: Date; timeZone: string; newSince: string },
): NavCounts {
  const count = (sql: string, ...params: unknown[]) =>
    (db
      .prepare(sql)
      .pluck()
      .get(...params) as number | undefined) ?? 0;
  const deadlines = listDeadlines(db, opts.now);
  return {
    newOpportunities: count(
      `SELECT COUNT(*) FROM opportunities
        WHERE dismissed_at IS NULL AND closed_at IS NULL AND first_seen_at > ?`,
      opts.newSince,
    ),
    deadlinesDue: dueSoon(deadlines.events, deadlines.followups, opts.now, opts.timeZone).length,
    followupsDue: listPipeline(db).filter((r) => followupDue(r, opts.now)).length,
    programsChanged: count(
      `SELECT COUNT(DISTINCT program_id) FROM alerts
        WHERE seen_at IS NULL AND program_id IS NOT NULL`,
    ),
    sourcesBroken: count(
      `SELECT COUNT(*) FROM sources
        WHERE enabled = 1 AND kind <> 'sample'
          AND (last_error IS NOT NULL OR consecutive_empty >= ?)`,
      BROKEN_AFTER_EMPTY_RUNS,
    ),
  };
}
