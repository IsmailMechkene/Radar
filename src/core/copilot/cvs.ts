// Radar Copilot tailored CVs: the content Claude Code writes from the master CV for one posting,
// and how it is stored. Pure database code; the CV is written in src/main/copilot and turned into
// a PDF there.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';

const line = (max: number) => z.string().max(max);

/** The answer Claude Code must give (also the stored and synced form). */
export const tailoredCvSchema = z.strictObject({
  name: z.string().min(1).max(120),
  /** One line under the name, e.g. "Software engineering student · AI/ML". */
  headline: line(160),
  /** Email, phone, city, links: copied from the master CV, never made up. */
  contact: z.array(line(160)).max(8),
  summary: line(900),
  skills: z.array(z.strictObject({ group: line(60), items: z.array(line(60)).max(20) })).max(8),
  sections: z
    .array(
      z.strictObject({
        /** "Experience", "Projects", "Education", ... */
        title: line(60),
        entries: z
          .array(
            z.strictObject({
              heading: line(160),
              /** Organization, place or stack. */
              detail: line(160),
              dates: line(60),
              bullets: z.array(line(300)).max(8),
            }),
          )
          .max(12),
      }),
    )
    .max(8),
  /** What was tailored and why (shown in Radar, not in the PDF). */
  changes: z.array(line(300)).max(8),
});
export type TailoredCv = z.output<typeof tailoredCvSchema>;

export interface StoredCv {
  cv: TailoredCv;
  model: string;
  costUsd: number | null;
  createdAt: string;
}

export function saveTailoredCv(
  db: Database.Database,
  opportunityKey: string,
  cv: TailoredCv,
  meta: { model: string; costUsd: number | null; at: Date },
): void {
  const parsed = tailoredCvSchema.parse(cv);
  db.prepare(
    `INSERT INTO copilot_cvs (opportunity_key, cv_json, model, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (opportunity_key) DO UPDATE SET cv_json = excluded.cv_json,
       model = excluded.model, cost_usd = excluded.cost_usd, created_at = excluded.created_at`,
  ).run(opportunityKey, JSON.stringify(parsed), meta.model, meta.costUsd, meta.at.toISOString());
}

const storedRowSchema = z.object({
  cv_json: z.string(),
  model: z.string(),
  cost_usd: z.number().nullable(),
  created_at: z.string(),
});

/**
 * The tailored CV of a posting (by id). undefined: none yet. Throws when the stored one cannot
 * be read (written by a newer Radar), so the page says so instead of showing nothing.
 */
export function getTailoredCv(db: Database.Database, opportunityId: number): StoredCv | undefined {
  const row = db
    .prepare(
      `SELECT c.cv_json, c.model, c.cost_usd, c.created_at
         FROM copilot_cvs c JOIN opportunities o ON o.dedupe_key = c.opportunity_key
        WHERE o.id = ?`,
    )
    .get(opportunityId);
  if (row === undefined) return undefined;
  const r = storedRowSchema.parse(row);
  let json: unknown = null;
  try {
    json = JSON.parse(r.cv_json);
  } catch {
    // reported below
  }
  const cv = tailoredCvSchema.safeParse(json);
  if (!cv.success) {
    throw new Error(
      'The stored tailored CV could not be read (written by a newer Radar?). Make it again.',
    );
  }
  return { cv: cv.data, model: r.model, costUsd: r.cost_usd, createdAt: r.created_at };
}

/** Whether a posting (by dedupe key) has a tailored CV. */
export function hasTailoredCv(db: Database.Database, opportunityKey: string): boolean {
  return (
    db
      .prepare('SELECT 1 FROM copilot_cvs WHERE opportunity_key = ?')
      .pluck()
      .get(opportunityKey) === 1
  );
}
