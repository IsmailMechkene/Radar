// Radar Copilot reviews: what an AI review holds, how it is stored, and which postings wait for
// one. Pure database code: the review itself is written by Claude Code in the main process
// (src/main/copilot); nothing here talks to an LLM.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';

/** The ten things every review rates, 1 to 5 (labels live in the renderer). */
export const DIMENSIONS = [
  'roleFit',
  'skills',
  'level',
  'location',
  'language',
  'company',
  'growth',
  'pay',
  'odds',
  'timing',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

const dimension = z.strictObject({
  score: z.int().min(1).max(5),
  note: z.string().max(300),
});
const point = z.string().min(1).max(300);

/** The answer Claude Code must give (also the stored and synced form). */
export const reviewSchema = z.strictObject({
  /** Overall fit, 0 to 5. The A-F grade comes from it (gradeOf), never from the model. */
  score: z.number().min(0).max(5),
  summary: z.string().min(1).max(800),
  dimensions: z.strictObject({
    roleFit: dimension,
    skills: dimension,
    level: dimension,
    location: dimension,
    language: dimension,
    company: dimension,
    growth: dimension,
    pay: dimension,
    odds: dimension,
    timing: dimension,
  }),
  strengths: z.array(point).max(6),
  gaps: z.array(point).max(6),
  redFlags: z.array(point).max(6),
  /** What the posting says or implies about pay; null when nothing. */
  salary: z.string().max(300).nullable(),
  /** One concrete next step (what to stress, what to fix before applying). */
  nextStep: z.string().max(400),
});
export type Review = z.output<typeof reviewSchema>;

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/** A 4.5+, B 4.0+, C 3.5+, D 3.0+, else F. Below 4.0 (C and lower) is usually not worth applying. */
export function gradeOf(score: number): Grade {
  if (score >= 4.5) return 'A';
  if (score >= 4.0) return 'B';
  if (score >= 3.5) return 'C';
  if (score >= 3.0) return 'D';
  return 'F';
}

export interface ReviewMeta {
  model: string;
  costUsd: number | null;
  at: Date;
}

/** Stores (or replaces) the review of the posting with this dedupe key. */
export function saveReview(
  db: Database.Database,
  opportunityKey: string,
  review: Review,
  meta: ReviewMeta,
): void {
  const parsed = reviewSchema.parse({ ...review, score: Math.round(review.score * 10) / 10 });
  db.prepare(
    `INSERT INTO copilot_reviews (opportunity_key, score, review_json, model, cost_usd, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (opportunity_key) DO UPDATE SET score = excluded.score,
       review_json = excluded.review_json, model = excluded.model, cost_usd = excluded.cost_usd,
       reviewed_at = excluded.reviewed_at`,
  ).run(
    opportunityKey,
    parsed.score,
    JSON.stringify(parsed),
    meta.model,
    meta.costUsd,
    meta.at.toISOString(),
  );
}

export function removeReview(db: Database.Database, opportunityKey: string): number {
  return db.prepare('DELETE FROM copilot_reviews WHERE opportunity_key = ?').run(opportunityKey)
    .changes;
}

/** Open, not dismissed, not dev sample data. */
const OPEN = `o.dismissed_at IS NULL AND o.closed_at IS NULL AND s.kind <> 'sample'`;
/** Postings the rules passed: these are reviewed. */
const PASSED = `o.verdict IN ('apply', 'maybe')`;

const verdictSchema = z.enum(['apply', 'maybe', 'needs_review', 'skip']).nullable();

const itemRowSchema = z.object({
  id: z.int(),
  dedupe_key: z.string(),
  title: z.string(),
  org: z.string(),
  location: z.string().nullable(),
  remote_type: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
  url: z.string(),
  deadline_at: z.string().nullable(),
  rule_score: z.number().nullable(),
  verdict: verdictSchema,
  review_json: z.string().nullable(),
  model: z.string().nullable(),
  cost_usd: z.number().nullable(),
  reviewed_at: z.string().nullable(),
});

export interface StoredReview {
  review: Review;
  grade: Grade;
  model: string;
  costUsd: number | null;
  reviewedAt: string;
}

export interface CopilotItem {
  id: number;
  title: string;
  org: string;
  location: string | null;
  remoteType: 'onsite' | 'hybrid' | 'remote' | 'unknown';
  url: string;
  deadlineAt: string | null;
  ruleScore: number | null;
  verdict: z.output<typeof verdictSchema>;
  /** null: waiting for a review (or the stored one could not be read: see `problem`). */
  stored: StoredReview | null;
  problem: string | null;
}

function toItem(row: z.output<typeof itemRowSchema>): CopilotItem {
  let stored: StoredReview | null = null;
  let problem: string | null = null;
  if (row.review_json !== null) {
    let json: unknown = null;
    try {
      json = JSON.parse(row.review_json);
    } catch {
      // reported below
    }
    const parsed = reviewSchema.safeParse(json);
    if (parsed.success) {
      stored = {
        review: parsed.data,
        grade: gradeOf(parsed.data.score),
        model: row.model ?? '',
        costUsd: row.cost_usd,
        reviewedAt: row.reviewed_at ?? '',
      };
    } else {
      problem = 'The stored review could not be read (written by a newer Radar?). Review it again.';
    }
  }
  return {
    id: row.id,
    title: row.title,
    org: row.org,
    location: row.location,
    remoteType: row.remote_type,
    url: row.url,
    deadlineAt: row.deadline_at,
    ruleScore: row.rule_score,
    verdict: row.verdict,
    stored,
    problem,
  };
}

/** Open postings the rules passed, and any open posting with a review: best reviews first. */
export function listCopilotItems(db: Database.Database): CopilotItem[] {
  return db
    .prepare(
      `SELECT o.id, o.dedupe_key, o.title, o.org, o.location, o.remote_type, o.url, o.deadline_at,
              o.score AS rule_score, o.verdict, r.review_json, r.model, r.cost_usd, r.reviewed_at
         FROM opportunities o
         JOIN sources s ON s.id = o.source_id
         LEFT JOIN copilot_reviews r ON r.opportunity_key = o.dedupe_key
        WHERE ${OPEN} AND (${PASSED} OR r.opportunity_key IS NOT NULL)
        ORDER BY r.score IS NULL, r.score DESC, o.score DESC, o.id`,
    )
    .all()
    .map((r) => toItem(itemRowSchema.parse(r)));
}

/** Ids waiting for a review (passed the rules, none stored yet), best rule score first. */
export function reviewQueue(db: Database.Database, limit = 10_000): number[] {
  return db
    .prepare(
      `SELECT o.id FROM opportunities o
         JOIN sources s ON s.id = o.source_id
        WHERE ${OPEN} AND ${PASSED}
          AND NOT EXISTS (SELECT 1 FROM copilot_reviews r WHERE r.opportunity_key = o.dedupe_key)
        ORDER BY o.score DESC, o.id
        LIMIT ?`,
    )
    .pluck()
    .all(limit) as number[];
}

const inputRowSchema = z.object({
  dedupe_key: z.string(),
  title: z.string(),
  org: z.string(),
  location: z.string().nullable(),
  remote_type: z.string(),
  opportunity_type: z.string(),
  language: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  deadline_at: z.string().nullable(),
  deadline_text: z.string().nullable(),
  eligibility_notes: z.string().nullable(),
  score: z.number().nullable(),
  verdict: verdictSchema,
});
export type ReviewInput = z.output<typeof inputRowSchema>;

/** What a review is written from; undefined when the posting no longer exists. */
export function reviewInput(db: Database.Database, id: number): ReviewInput | undefined {
  const row = db
    .prepare(
      `SELECT dedupe_key, title, org, location, remote_type, opportunity_type, language, url,
              description, deadline_at, deadline_text, eligibility_notes, score, verdict
         FROM opportunities WHERE id = ?`,
    )
    .get(id);
  return row === undefined ? undefined : inputRowSchema.parse(row);
}
