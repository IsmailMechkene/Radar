// The rules in use: the user's version from the Rules page, else seeds/rules.json. A stored
// version that no longer validates is reported, never silently replaced.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { opportunityRowSchema } from '../db/schemas';
import type { ScoringInput } from './engine';
import { parseRules, type Rules } from './schema';

export type UserRules = { rules: Rules; updatedAt: string } | { error: string } | null;

export function getUserRules(db: Database.Database): UserRules {
  const row = db.prepare('SELECT rules_json, updated_at FROM user_rules WHERE id = 1').get() as
    { rules_json: string; updated_at: string } | undefined;
  if (!row) return null;
  try {
    return { rules: parseRules(JSON.parse(row.rules_json)), updatedAt: row.updated_at };
  } catch (err) {
    const message = err instanceof z.ZodError ? z.prettifyError(err) : String(err);
    return { error: `Your saved rules are invalid, so the default rules are used: ${message}` };
  }
}

/** The rules to score with: the user's (when valid) or the defaults. */
export function effectiveRules(
  db: Database.Database,
  defaults: Rules,
): { rules: Rules; custom: boolean; error: string | null } {
  const user = getUserRules(db);
  if (user && 'rules' in user) return { rules: user.rules, custom: true, error: null };
  return { rules: defaults, custom: false, error: user && 'error' in user ? user.error : null };
}

export function saveUserRules(db: Database.Database, raw: unknown, now: Date): Rules {
  const rules = parseRules(raw);
  db.prepare(
    `INSERT INTO user_rules (id, rules_json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET rules_json = excluded.rules_json, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(rules), now.toISOString());
  return rules;
}

/** Back to seeds/rules.json. */
export function resetUserRules(db: Database.Database): boolean {
  return db.prepare('DELETE FROM user_rules WHERE id = 1').run().changes > 0;
}

export interface PreviewItem extends ScoringInput {
  id: number;
  /** As stored now (scored with the saved rules). */
  score: number | null;
  verdict: string | null;
}

/**
 * A handful of real postings for the live preview: the best scored, some in the middle and some
 * skipped, so moving a weight shows movement on both sides of the thresholds.
 */
export function previewItems(db: Database.Database, perGroup = 2): PreviewItem[] {
  const pick = (where: string, order: string) =>
    db
      .prepare(
        `SELECT o.* FROM opportunities o JOIN sources s ON s.id = o.source_id
          WHERE s.kind <> 'sample' AND o.opportunity_type <> 'program' AND o.closed_at IS NULL
            AND o.dismissed_at IS NULL AND ${where}
          ORDER BY ${order} LIMIT ?`,
      )
      .all(perGroup)
      .map((r) => opportunityRowSchema.parse(r));
  const rows = [
    ...pick("o.verdict = 'apply'", 'o.score DESC'),
    ...pick("o.verdict IN ('maybe', 'needs_review')", 'o.score DESC'),
    ...pick("o.verdict = 'skip' AND o.opportunity_type IN ('internship', 'pfe')", 'o.score DESC'),
    ...pick(
      "o.verdict = 'skip' AND o.opportunity_type NOT IN ('internship', 'pfe')",
      'o.score DESC',
    ),
  ];
  return rows.map((o) => ({
    id: o.id,
    org: o.org,
    title: o.title,
    location: o.location,
    remote_type: o.remote_type,
    opportunity_type: o.opportunity_type,
    language: o.language,
    description: o.description,
    posted_at: o.posted_at,
    first_seen_at: o.first_seen_at,
    deadline_at: o.deadline_at,
    score: o.score,
    verdict: o.verdict,
  }));
}
