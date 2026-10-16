// Scan run log (SPEC section 8: every scan is recorded with counts and errors).
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { utcTimestampSchema } from './schemas';

export const runTriggerSchema = z.enum(['schedule', 'startup', 'manual', 'cli']);
export type RunTrigger = z.output<typeof runTriggerSchema>;

export const runRowSchema = z.object({
  id: z.int(),
  started_at: utcTimestampSchema,
  finished_at: utcTimestampSchema.nullable(),
  trigger: runTriggerSchema,
  sources_ok: z.int(),
  sources_failed: z.int(),
  new_items: z.int(),
  error_summary: z.string().nullable(),
});
export type RunRow = z.output<typeof runRowSchema>;

export function startRun(db: Database.Database, trigger: RunTrigger, now: Date): number {
  const row = db
    .prepare('INSERT INTO runs (started_at, "trigger") VALUES (?, ?) RETURNING id')
    .get(now.toISOString(), runTriggerSchema.parse(trigger)) as { id: number };
  return row.id;
}

export function finishRun(
  db: Database.Database,
  id: number,
  r: { sourcesOk: number; sourcesFailed: number; newItems: number; errorSummary: string | null },
  now: Date,
): void {
  db.prepare(
    `UPDATE runs SET finished_at = ?, sources_ok = ?, sources_failed = ?, new_items = ?,
       error_summary = ? WHERE id = ?`,
  ).run(now.toISOString(), r.sourcesOk, r.sourcesFailed, r.newItems, r.errorSummary, id);
}

/** Most recent finished run, if any. */
export function latestFinishedRun(db: Database.Database): RunRow | undefined {
  const row = db
    .prepare('SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1')
    .get();
  return row === undefined ? undefined : runRowSchema.parse(row);
}

/** Most recent run with at least one source scanned successfully (drives the heartbeat). */
export function latestSuccessfulRun(db: Database.Database): RunRow | undefined {
  const row = db
    .prepare(
      'SELECT * FROM runs WHERE finished_at IS NOT NULL AND sources_ok > 0 ORDER BY id DESC LIMIT 1',
    )
    .get();
  return row === undefined ? undefined : runRowSchema.parse(row);
}
